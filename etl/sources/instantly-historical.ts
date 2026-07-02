import { admin } from "../lib/supabase-admin";
import { batchResolveOrCreate } from "../lib/identity";

/**
 * Instantly HISTORICAL ETL — pull per-lead engagement summary from /leads/list.
 *
 * Unlike /emails which returns only sent events, /leads/list returns each
 * contact with cumulative counters:
 *   - email_open_count
 *   - email_click_count
 *   - email_reply_count
 *
 * We synthesize 1 touchpoint per (lead, event_type) with count > 0.
 * Dedup by (source, lead_id, event_type) — one representative row per signal.
 */

const API_KEY = process.env.INSTANTLY_API_KEY;
const BASE_URL = process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2";

type InstantlyLead = {
  id: string;
  timestamp_created?: string;
  timestamp_updated?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  job_title?: string;
  email_open_count?: number;
  email_click_count?: number;
  email_reply_count?: number;
  payload?: Record<string, unknown>;
};

async function fetchWithRetry(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 60_000));
    return fetchWithRetry(path, body);
  }
  if (!res.ok) throw new Error(`Instantly ${path} → ${res.status}`);
  return res.json();
}

export async function pullFromInstantlyHistorical() {
  if (!API_KEY) throw new Error("Missing INSTANTLY_API_KEY");
  console.log("📡 [Instantly HISTORICAL] Pulling per-lead engagement...");

  const { data: jobData, error: jobErr } = await admin
    .from("sync_job")
    .insert({ source: "instantly", status: "running", records_in: 0, records_merged: 0 })
    .select().single();
  if (jobErr) throw new Error(`sync_job: ${jobErr.message}`);
  const jobId = jobData.id;

  const allLeads: InstantlyLead[] = [];
  let starting_after: string | undefined;
  let page = 0;
  const MAX_PAGES = 500; // ~50k leads max per run

  while (page < MAX_PAGES) {
    const body: Record<string, unknown> = { limit: 100 };
    if (starting_after) body.starting_after = starting_after;

    const resp = await fetchWithRetry("/leads/list", body);
    const items: InstantlyLead[] = resp.items || [];
    if (items.length === 0) break;

    allLeads.push(...items);
    starting_after = resp.next_starting_after || items[items.length - 1]?.id;
    page++;
    if (page % 10 === 0) {
      console.log(`   ↳ Page ${page}: ${allLeads.length} leads total`);
    }
    if (!resp.next_starting_after) break;
  }
  console.log(`📦 Pulled ${allLeads.length} leads from ${page} pages`);

  // Filter leads with engagement
  const engaged = allLeads.filter(l =>
    (l.email_open_count || 0) > 0 ||
    (l.email_click_count || 0) > 0 ||
    (l.email_reply_count || 0) > 0
  );
  console.log(`   ↳ ${engaged.length} leads have engagement (opens/clicks/replies)`);

  if (engaged.length === 0) {
    await admin.from("sync_job").update({
      status: "success", finished_at: new Date().toISOString(),
      records_in: allLeads.length, records_merged: 0
    }).eq("id", jobId);
    return { inserted: 0, jobId };
  }

  // Identity resolve
  const identityRecords = engaged
    .filter(l => l.email)
    .map(l => ({
      id: l.id,
      email: (l.email || "").toLowerCase().trim(),
      name: [l.first_name, l.last_name].filter(Boolean).join(" ") || undefined,
      phone: undefined,
    }));
  const matches = await batchResolveOrCreate(identityRecords, { source: "instantly" });
  const matchMap = new Map(matches.map(m => [m.rawId, m.leadId]));

  // Build touchpoints - 1 per (lead, event_type)
  const touchpoints: Array<{
    lead_id: string; source: string; event_type: string;
    title: string; occurred_at: string; payload: Record<string, unknown>;
  }> = [];

  for (const lead of engaged) {
    const leadId = matchMap.get(lead.id);
    if (!leadId) continue;
    const occurredAt = lead.timestamp_updated || lead.timestamp_created || new Date().toISOString();
    const basePayload = {
      instantly_lead_id: lead.id,
      company_name: lead.company_name,
      job_title: lead.job_title,
      via: "historical",
      real: true,
    };

    if ((lead.email_open_count || 0) > 0) {
      touchpoints.push({
        lead_id: leadId, source: "instantly", event_type: "email_open",
        title: `Đã mở email (${lead.email_open_count} lần)`,
        occurred_at: occurredAt,
        payload: { ...basePayload, count: lead.email_open_count, raw_id: `hist-open-${lead.id}` },
      });
    }
    if ((lead.email_click_count || 0) > 0) {
      touchpoints.push({
        lead_id: leadId, source: "instantly", event_type: "email_click",
        title: `Đã click email (${lead.email_click_count} lần)`,
        occurred_at: occurredAt,
        payload: { ...basePayload, count: lead.email_click_count, raw_id: `hist-click-${lead.id}` },
      });
    }
    if ((lead.email_reply_count || 0) > 0) {
      touchpoints.push({
        lead_id: leadId, source: "instantly", event_type: "email_reply",
        title: `Đã reply email (${lead.email_reply_count} lần)`,
        occurred_at: occurredAt,
        payload: { ...basePayload, count: lead.email_reply_count, raw_id: `hist-reply-${lead.id}` },
      });
    }
  }
  console.log(`   ↳ Built ${touchpoints.length} touchpoints`);

  // Dedup vs DB (by raw_id which is deterministic: hist-{type}-{lead_id})
  const existingKeys = new Set<string>();
  let from = 0;
  while (true) {
    const { data } = await admin.from("fact_touchpoint")
      .select("payload").eq("source", "instantly").range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      const rid = (r.payload as any)?.raw_id;
      if (rid) existingKeys.add(rid);
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  const newTouchpoints = touchpoints.filter(t => {
    const rid = (t.payload as any).raw_id;
    return !existingKeys.has(rid);
  });
  console.log(`   ↳ ${touchpoints.length - newTouchpoints.length} already in DB, ${newTouchpoints.length} new to insert`);

  // Insert in batches
  let inserted = 0;
  for (let i = 0; i < newTouchpoints.length; i += 100) {
    const batch = newTouchpoints.slice(i, i + 100);
    const { error } = await admin.from("fact_touchpoint").insert(batch);
    if (error) {
      console.warn(`   ⚠️ Insert batch ${i}: ${error.message}`);
      continue;
    }
    inserted += batch.length;
    if (inserted % 1000 === 0) console.log(`   💾 Inserted ${inserted}...`);
  }
  console.log(`✅ [Instantly HISTORICAL] ${inserted} new touchpoints`);

  await admin.from("sync_job").update({
    status: "success", finished_at: new Date().toISOString(),
    records_in: allLeads.length, records_merged: inserted
  }).eq("id", jobId);

  return { inserted, jobId };
}
