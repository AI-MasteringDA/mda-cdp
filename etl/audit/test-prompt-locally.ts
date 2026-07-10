/**
 * Local sanity test — pull real chat from SMAX API for 1 thread,
 * call Claude Haiku with our prompt, print result.
 *
 * DOES NOT touch Supabase. Safe to run during incident.
 *
 * Usage:
 *   npx tsx etl/audit/test-prompt-locally.ts
 *
 * Iterate the prompt until output feels right before we wire the full pipeline.
 */
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildUserPrompt, validateAuditResult, SmaxMessage, loadAllowedSmaxTags } from "./prompt-missing-tags";
import { admin } from "../lib/supabase-admin";

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// TODO: replace with real page_pid + tid for a lead we want to spot-check.
// Recommend picking a lead you KNOW should have missing tags, so you can
// verify AI catches it correctly.
const SAMPLES: Array<{ label: string; page_pid: string; tid: string; leadName: string; currentTags: string[] }> = [
  {
    label: "Sample 1 — Đức Hiếu (K61, Hot Lead — should be complete)",
    page_pid: "zlw543187459113764384",
    tid: "6a4ca1c9a0f42e558c962204",
    leadName: "Đức Hiếu",
    currentTags: ["K61", "Hot Lead", "Bot BI 1", "SF_Done", "Bot BI 2"],
  },
  // Add more real samples here after picking them from Lark
];

type RawSmaxMessage = {
  id: string;
  message?: string;
  sender_pid?: string;
  page_pid?: string;
  created_at?: string;
};

async function pullThreadMessages(page_pid: string, tid: string): Promise<SmaxMessage[]> {
  const url = `${BASE}/bizs/${BIZ_SLUG}/pages/${page_pid}/threads/${tid}/messages?sort=-created_at&limit=30`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`SMAX ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const raw = (data.data || []) as RawSmaxMessage[];
  return raw
    .filter((m) => (m.message || "").trim().length > 0)
    .map<SmaxMessage>((m) => ({
      sender_is_staff: !!(m.sender_pid && m.page_pid && m.sender_pid === m.page_pid),
      content: (m.message || "").trim(),
      occurred_at: m.created_at || new Date().toISOString(),
    }));
}

async function callClaude(userPrompt: string) {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    tokens_in: response.usage.input_tokens,
    tokens_out: response.usage.output_tokens,
  };
}

async function main() {
  if (!ANTHROPIC_KEY) throw new Error("Missing ANTHROPIC_API_KEY in .env.local");
  if (!TOKEN) throw new Error("Missing SMAX_USER_TOKEN in .env.local");

  // Load tag whitelist ONCE from Supabase (dim_lead.smax_tags union)
  console.log("Loading tag whitelist from dim_lead...");
  const allowedTags = await loadAllowedSmaxTags(admin);
  console.log(`   ↳ Loaded ${allowedTags.size} distinct tags: ${Array.from(allowedTags).slice(0, 15).join(", ")}${allowedTags.size > 15 ? `, ... (+${allowedTags.size - 15})` : ""}`);

  for (const sample of SAMPLES) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`▶ ${sample.label}`);
    console.log("=".repeat(70));

    const messages = await pullThreadMessages(sample.page_pid, sample.tid);
    console.log(`   Pulled ${messages.length} messages`);
    if (messages.length === 0) { console.log("   (skip — no messages)"); continue; }

    const userPrompt = buildUserPrompt({
      leadName: sample.leadName,
      currentTags: sample.currentTags,
      messages,
      allowedTags,
    });

    const t0 = Date.now();
    const { text, tokens_in, tokens_out } = await callClaude(userPrompt);
    const cost = tokens_in * 0.0000008 + tokens_out * 0.000004; // Haiku pricing
    console.log(`   [Claude] ${Date.now() - t0}ms · ${tokens_in} in / ${tokens_out} out · $${cost.toFixed(5)}`);

    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { console.log(`\n   ⚠️  Non-JSON output:\n${text}`); continue; }

    const validated = validateAuditResult(parsed, allowedTags);
    console.log(`\n   Result:`);
    console.log(`     missing_tags: [${validated.missing_tags.join(", ")}]`);
    console.log(`     note: ${validated.note}`);
    if (validated.evidence.length) {
      console.log(`     evidence:`);
      validated.evidence.forEach((e) => console.log(`       • ${e.tag}: "${e.quote.slice(0, 80)}" — ${e.reason}`));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
