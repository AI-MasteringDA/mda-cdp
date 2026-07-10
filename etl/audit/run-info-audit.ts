/**
 * "Chưa xin info" audit — one-shot over leads active in the last N days.
 *
 * Logic per lead (active window only):
 *   1. Has Email or Phone in Lark          → info collected  → untick
 *   2. No contact + has chat history       → Claude Haiku reads the chat:
 *        did TVV ever ASK for phone/email/Zalo? (asking counts even if the
 *        customer never gave it — per Ops: "đã xin nhưng KH chưa cho" is OK)
 *        → not asked → TICK + write reason to "AI Note"
 *   3. No contact + no chat                → no evidence → skip
 *
 * Usage:
 *   npx tsx etl/audit/run-info-audit.ts              # last 14 days
 *   DAYS=30 LIMIT=20 npx tsx etl/audit/run-info-audit.ts   # smoke test
 */
import Anthropic from "@anthropic-ai/sdk";
import { admin as _a } from "../lib/supabase-admin";
void _a;

const LARK_APP_ID = process.env.LARK_APP_ID || "";
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || "";
const APP_TOKEN = process.env.LARK_BASE_APP_TOKEN || "";
const BASE_URL = "https://open.larksuite.com/open-apis";
const DAYS = Number(process.env.DAYS || 14);
const LIMIT = Number(process.env.LIMIT || 0);
const MODEL = "claude-haiku-4-5";
const CHAT_PROMPT_CHARS = 8000; // newest slice of the merged chat

const SYSTEM = `Bạn là audit AI cho đội Sales của Mastering Data Analytics.
Đọc hội thoại giữa TVV (nhân viên tư vấn) và Khách. Nhiệm vụ DUY NHẤT: xác định TVV đã từng HỎI XIN thông tin liên hệ của khách chưa (số điện thoại, email, Zalo, hoặc mời khách để lại thông tin liên hệ).
- "asked" = true nếu TVV đã hỏi xin — kể cả khi khách chưa trả lời/từ chối.
- "asked" = false nếu trong toàn bộ hội thoại TVV CHƯA TỪNG hỏi xin.
- Tin nhắn bot tự động có câu xin thông tin cũng tính là đã hỏi.
Trả về DUY NHẤT JSON: {"asked": true|false, "reason": "1 câu ngắn tiếng Việt, dẫn chứng nếu có"}`;

async function larkToken(): Promise<string> {
  const r = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET }),
  }).then(x => x.json());
  return r.tenant_access_token;
}

type Row = { record_id: string; name: string; hasContact: boolean; chat: string };

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const token = await larkToken();
  const tRes = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const tableId = tRes.data.items.find((t: { name: string }) => t.name === "SMAX_Database").table_id;

  // 1. Collect in-window rows
  const cutoff = Date.now() - DAYS * 86400_000;
  const rows: Row[] = [];
  let pageToken: string | undefined;
  while (true) {
    const url = new URL(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`);
    url.searchParams.set("page_size", "500");
    url.searchParams.set("field_names", JSON.stringify([
      "Time", "Lead Name", "Email", "Phone",
      "Chat History 1", "Chat History 2", "Chat History 3", "Chat History 4", "Chat History 5",
    ]));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    for (const r of res.data?.items ?? []) {
      const t = typeof r.fields?.Time === "number" ? r.fields.Time : 0;
      if (t < cutoff) continue;
      const chat = [1, 2, 3, 4, 5].map(i => String(r.fields?.[`Chat History ${i}`] ?? "")).join("");
      rows.push({
        record_id: r.record_id,
        name: String(r.fields?.["Lead Name"] ?? ""),
        hasContact: !!(r.fields?.Email || r.fields?.Phone),
        chat,
      });
    }
    if (!res.data?.has_more) break;
    pageToken = res.data.page_token;
  }
  console.log(`In-window (${DAYS}d) rows: ${rows.length}`);

  const updates: Array<{ record_id: string; fields: Record<string, unknown> }> = [];
  // 2a. Contact present → info collected → untick
  for (const r of rows.filter(x => x.hasContact)) {
    updates.push({ record_id: r.record_id, fields: { "Chưa xin info": false } });
  }

  // 2b. No contact + chat → AI
  let aiTargets = rows.filter(x => !x.hasContact && x.chat.trim().length > 50);
  if (LIMIT > 0) aiTargets = aiTargets.slice(0, LIMIT);
  console.log(`AI reads: ${aiTargets.length} leads (no contact, has chat)`);

  let ticked = 0, unticked = 0, aiFail = 0;
  let tokensIn = 0, tokensOut = 0;
  const CONC = 4;
  for (let i = 0; i < aiTargets.length; i += CONC) {
    const batch = aiTargets.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async (r) => {
      const chatTail = r.chat.length > CHAT_PROMPT_CHARS ? r.chat.slice(-CHAT_PROMPT_CHARS) : r.chat;
      try {
        const resp = await client.messages.create({
          model: MODEL,
          max_tokens: 200,
          system: SYSTEM,
          messages: [{ role: "user", content: `Khách: "${r.name}"\n\nHội thoại:\n${chatTail}\n\nJSON:` }],
        });
        tokensIn += resp.usage.input_tokens;
        tokensOut += resp.usage.output_tokens;
        const text = resp.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map(b => b.text).join("");
        const m = text.match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) as { asked?: boolean; reason?: string } : null;
        if (!parsed || typeof parsed.asked !== "boolean") return { r, err: true as const };
        return { r, asked: parsed.asked, reason: String(parsed.reason ?? "").slice(0, 200) };
      } catch {
        return { r, err: true as const };
      }
    }));
    for (const res of results) {
      if ("err" in res) { aiFail++; continue; }
      if (res.asked) {
        updates.push({ record_id: res.r.record_id, fields: { "Chưa xin info": false } });
        unticked++;
      } else {
        updates.push({
          record_id: res.r.record_id,
          fields: { "Chưa xin info": true, "AI Note": `Chưa xin info: ${res.reason}` },
        });
        ticked++;
      }
    }
    if ((i + CONC) % 40 === 0 || i + CONC >= aiTargets.length) {
      console.log(`   AI ${Math.min(i + CONC, aiTargets.length)}/${aiTargets.length} · tick=${ticked} untick=${unticked} fail=${aiFail}`);
    }
  }

  // 3. Write updates
  let written = 0;
  for (let i = 0; i < updates.length; i += 400) {
    const chunk = updates.slice(i, i + 400);
    const res = await fetch(`${BASE_URL}/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: chunk }),
    }).then(r => r.json());
    if (res.code === 0) written += chunk.length;
    else console.warn(`   ⚠️ batch_update: ${JSON.stringify(res).slice(0, 150)}`);
    await new Promise(r => setTimeout(r, 300));
  }

  const cost = tokensIn * 0.0000008 + tokensOut * 0.000004;
  console.log(`\n✅ Audit done:`);
  console.log(`   "Chưa xin info" TICKED:   ${ticked}  (TVV chưa từng xin info)`);
  console.log(`   unticked (đã xin/có info): ${unticked + rows.filter(x => x.hasContact).length}`);
  console.log(`   AI failures skipped:       ${aiFail}`);
  console.log(`   Rows written to Lark:      ${written}`);
  console.log(`   AI cost: $${cost.toFixed(3)} (${tokensIn} in / ${tokensOut} out tokens)`);
}
main().catch(e => { console.error(e); process.exit(1); });
