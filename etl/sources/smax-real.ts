import { admin } from "../lib/supabase-admin";
import { batchResolveOrCreate, logMatches } from "../lib/identity";

/**
 * SMAX REAL connector — pull threads (chat sessions) qua POST API
 *
 * Pattern:
 *   POST /bizs/{slug}/threads  body: { page_pids: [...], skip, limit }
 *
 * Mỗi thread = 1 cuộc chat với 1 khách, chứa customer info + last message.
 * Map vào fact_touchpoint (event_type='chat') + auto-create dim_lead.
 *
 * Identity match: ưu tiên phone, fallback email.
 * Tag aliases được lưu vào payload để Growth phân tích sau.
 */

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";

const PAGE_PIDS = [
  "fb102323788540150",      // FB Brand
  "fb107203051058856",      // FB KOL
  "zlw543187459113764384",  // Zalo main
  "zl2235256473219383054",  // Zalo other
  "ctm68188e11779d16c0779c018c",  // Website live chat
  "ig17841446528067260",    // IG Brand
  "ig17841460097450702",    // IG KOL
];

type SmaxThread = {
  id: string;
  tid: string;
  page_pid: string;
  platform: string;
  message?: string;
  last_message_at?: string;
  last_message_by_customer_at?: string;
  tag_aliases?: string[];
  emails?: string[];
  phones?: string[];
  customer?: {
    id: string;
    pid: string;
    name?: string;
    profile_name?: string;
    phone?: string;
    email?: string;
    picture?: string;
    gender?: string;
    page_pid?: string;
    platform?: string;
  };
};

async function smaxPost(path: string, body: unknown) {
  if (!TOKEN) throw new Error("Thiếu SMAX_USER_TOKEN / SMAX_API_KEY trong .env.local");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SMAX API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function pullFromSmaxReal() {
  console.log("📡 [SMAX REAL] Đang gọi API thật...");

  const { data: jobData, error: jobErr } = await admin
    .from("sync_job")
    .insert({ source: "smax", status: "running", records_in: 0, records_merged: 0 })
    .select()
    .single();
  if (jobErr) throw new Error(`Tạo sync_job: ${jobErr.message}`);
  const jobId = jobData.id;

  try {
    // Pagination — pull threads in batches
    const allThreads: SmaxThread[] = [];
    let skip = 0;
    const LIMIT = 100;
    const MAX_PAGES = 200;  // ~20000 threads max
    let page = 0;

    while (page < MAX_PAGES) {
      const resp: { data?: SmaxThread[]; total?: number } = await smaxPost(
        `/bizs/${BIZ_SLUG}/threads`,
        { page_pids: PAGE_PIDS, skip, limit: LIMIT }
      );
      const items = resp.data || [];
      allThreads.push(...items);
      if (items.length < LIMIT) break;
      skip += LIMIT;
      page++;
    }

    const channelStats: Record<string, number> = {};
    for (const t of allThreads) {
      const key = t.platform || "unknown";
      channelStats[key] = (channelStats[key] || 0) + 1;
    }
    console.log(`📦 [SMAX] Pull ${allThreads.length} threads từ ${page + 1} pages`);
    console.log(`   ↳ Theo platform:`, channelStats);

    if (allThreads.length === 0) {
      await admin
        .from("sync_job")
        .update({ status: "success", finished_at: new Date().toISOString(), records_in: 0, records_merged: 0 })
        .eq("id", jobId);
      console.log("⚠️  Không có thread nào");
      return { inserted: 0, jobId };
    }

    // Identity resolution — match by phone or email, auto-create new
    const identityRecords = allThreads
      .filter((t) => t.customer)
      .map((t) => ({
        id: t.id,
        email: t.customer?.email || (t.emails && t.emails[0]) || null,
        phone: t.customer?.phone || (t.phones && t.phones[0]) || null,
        name: t.customer?.name || t.customer?.profile_name || null,
      }))
      .filter((r) => r.email || r.phone);

    const matches = await batchResolveOrCreate(identityRecords, { source: "smax" });
    logMatches(matches, "SMAX REAL");

    // Build touchpoints (1 per thread)
    const matchMap = new Map(matches.map((m) => [m.rawId, m.leadId]));
    const touchpoints = allThreads
      .filter((t) => matchMap.get(t.id))
      .map((t) => {
        const customer = t.customer;
        const msg = t.message?.slice(0, 60) || "(no message)";
        const ellipsis = (t.message?.length || 0) > 60 ? "..." : "";
        return {
          lead_id: matchMap.get(t.id)!,
          source: "smax",
          event_type: "chat",
          title: `Chat: ${msg}${ellipsis}`,
          detail: t.message || null,
          occurred_at: t.last_message_at || t.last_message_by_customer_at || new Date().toISOString(),
          payload: {
            thread_id: t.id,
            tid: t.tid,
            page_pid: t.page_pid,
            platform: t.platform,
            tag_aliases: t.tag_aliases || [],
            customer_name: customer?.name || customer?.profile_name,
            real: true,
          },
        };
      });

    if (touchpoints.length > 0) {
      // PAGINATED fetch existing thread_ids (handle >1000 rows)
      const existingThreadIds = new Set<string>();
      let from = 0;
      while (true) {
        const { data, error } = await admin
          .from("fact_touchpoint")
          .select("payload")
          .eq("source", "smax")
          .range(from, from + 999);
        if (error || !data || data.length === 0) break;
        for (const t of data) {
          const tid = (t.payload as { thread_id?: string })?.thread_id;
          if (tid) existingThreadIds.add(tid);
        }
        if (data.length < 1000) break;
        from += 1000;
      }
      console.log(`   ↳ Cache ${existingThreadIds.size} existing thread_ids`);

      const newTouchpoints = touchpoints.filter(
        (t) => !existingThreadIds.has((t.payload as { thread_id: string }).thread_id)
      );
      const skipped = touchpoints.length - newTouchpoints.length;
      if (skipped > 0) {
        console.log(`   ↳ Skip ${skipped} touchpoint đã tồn tại (dedupe by thread_id)`);
      }

      if (newTouchpoints.length > 0) {
        const BATCH = 100;
        let inserted = 0;
        let failed = 0;
        for (let i = 0; i < newTouchpoints.length; i += BATCH) {
          const batch = newTouchpoints.slice(i, i + BATCH);
          const { error } = await admin.from("fact_touchpoint").insert(batch);
          if (error) {
            // Fallback: one-by-one để skip rows bị conflict
            for (const tp of batch) {
              const { error: e } = await admin.from("fact_touchpoint").insert([tp]);
              if (!e) inserted++;
              else failed++;
            }
            continue;
          }
          inserted += batch.length;
        }
        if (failed > 0) console.log(`   ⚠️ ${failed} touchpoint skip do conflict`);
        console.log(`✅ [SMAX REAL] Insert ${inserted} fact_touchpoint mới từ ${allThreads.length} threads`);
      } else {
        console.log(`✅ [SMAX REAL] 0 touchpoint mới — DB đã up-to-date`);
      }
    }

    await admin
      .from("sync_job")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_in: allThreads.length,
        records_merged: touchpoints.length,
      })
      .eq("id", jobId);

    return { inserted: touchpoints.length, jobId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("sync_job")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: msg.slice(0, 500),
      })
      .eq("id", jobId);
    throw e;
  }
}
