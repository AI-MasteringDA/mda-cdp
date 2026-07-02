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
    // INCREMENTAL: find the last_message_at of the most recent SMAX touchpoint.
    // Stop pulling when we reach threads older than that (already in DB).
    // First run with empty table: pulls everything (subject to MAX_PAGES).
    let cutoffMs = 0;
    {
      const { data: lastTp } = await admin
        .from("fact_touchpoint")
        .select("occurred_at")
        .eq("source", "smax")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastTp?.occurred_at) {
        cutoffMs = new Date(lastTp.occurred_at).getTime();
        const overlapMin = Number(process.env.SMAX_OVERLAP_MINUTES || 30);
        cutoffMs -= overlapMin * 60_000; // small overlap so we don't miss updates
        console.log(`   ↻ Incremental: pulling threads with last_message_at > ${new Date(cutoffMs).toISOString().slice(0, 19)}`);
      } else {
        console.log(`   ⚙️  No prior SMAX data → full backfill mode`);
      }
    }

    // Pagination — pull EACH platform separately (API returns max 100 per call
    // when multiple page_pids passed together, but 100 PER platform when isolated).
    // → 7x more data per run.
    const allThreads: SmaxThread[] = [];
    const LIMIT = 100;
    const MAX_PAGES_PER_PLATFORM = Number(process.env.SMAX_MAX_PAGES_PER_PLATFORM || 50);
    let totalPagesUsed = 0;

    for (const pagePid of PAGE_PIDS) {
      let skip = 0;
      let page = 0;
      let platformEarlyStop = false;

      while (page < MAX_PAGES_PER_PLATFORM) {
        const resp: { data?: SmaxThread[]; total?: number } = await smaxPost(
          `/bizs/${BIZ_SLUG}/threads`,
          { page_pids: [pagePid], skip, limit: LIMIT }
        );
        const items = resp.data || [];
        if (items.length === 0) break;

        // Check cutoff
        if (cutoffMs > 0 && items.length > 0) {
          const oldestInPage = items
            .map((t) => new Date(t.last_message_at || t.last_message_by_customer_at || 0).getTime())
            .filter((ms) => ms > 0)
            .reduce((min, ms) => Math.min(min, ms), Infinity);
          if (oldestInPage > 0 && oldestInPage < cutoffMs) {
            const inRange = items.filter((t) => {
              const ms = new Date(t.last_message_at || t.last_message_by_customer_at || 0).getTime();
              return ms > cutoffMs;
            });
            allThreads.push(...inRange);
            platformEarlyStop = true;
            break;
          }
        }

        allThreads.push(...items);
        if (items.length < LIMIT) break;
        skip += LIMIT;
        page++;
      }
      totalPagesUsed += page + 1;
      console.log(`   ↳ platform ${pagePid.slice(0, 20)}... : ${page + 1} pages, cutoff=${platformEarlyStop ? "yes" : "no"}`);
    }

    // DEDUPE allThreads by t.id — SMAX API có thể trả cùng thread qua nhiều
    // page_pids/pages (overlap bug bên SMAX side). Bỏ dup ngay để tránh insert 200x.
    const beforeDedup = allThreads.length;
    const seenIds = new Set<string>();
    const dedupedThreads: SmaxThread[] = [];
    for (const t of allThreads) {
      if (seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      dedupedThreads.push(t);
    }
    allThreads.length = 0;
    allThreads.push(...dedupedThreads);
    if (beforeDedup !== allThreads.length) {
      console.log(`   ↳ De-duped ${beforeDedup - allThreads.length} threads (in-batch dup) → ${allThreads.length} unique`);
    }

    const channelStats: Record<string, number> = {};
    for (const t of allThreads) {
      const key = t.platform || "unknown";
      channelStats[key] = (channelStats[key] || 0) + 1;
    }
    console.log(`📦 [SMAX] Pull ${allThreads.length} threads từ ${totalPagesUsed} pages across ${PAGE_PIDS.length} platforms`);
    console.log(`   ↳ Theo platform:`, channelStats);

    if (allThreads.length === 0) {
      await admin
        .from("sync_job")
        .update({ status: "success", finished_at: new Date().toISOString(), records_in: 0, records_merged: 0 })
        .eq("id", jobId);
      console.log("⚠️  Không có thread nào");
      return { inserted: 0, jobId };
    }

    // Identity resolution — match by phone/email OR SMAX customer_id (fallback for anonymous)
    const identityRecords = allThreads
      .filter((t) => t.customer)
      .map((t) => ({
        id: t.id,
        email: t.customer?.email || (t.emails && t.emails[0]) || null,
        phone: t.customer?.phone || (t.phones && t.phones[0]) || null,
        name: t.customer?.name || t.customer?.profile_name || null,
        smax_customer_id: t.customer?.id || null,
        external_platform: t.platform || null,
        external_profile_id: t.customer?.pid || null,
      }));
      // No filter — accept anonymous customers too (SMAX customer_id as fallback)

    const matches = await batchResolveOrCreate(identityRecords, { source: "smax" });
    logMatches(matches, "SMAX REAL");

    // Build touchpoints (1 per thread)
    // CLASSIFY SENDER: compare last_message_at vs last_message_by_customer_at
    //   if last_message_at > last_message_by_customer_at → TVV/staff sent last → event_type='chat_staff'
    //   if equal or no staff time → customer sent last → event_type='chat'
    const matchMap = new Map(matches.map((m) => [m.rawId, m.leadId]));
    const touchpoints = allThreads
      .filter((t) => matchMap.get(t.id))
      .map((t) => {
        const customer = t.customer;
        const msg = t.message?.slice(0, 60) || "(no message)";
        const ellipsis = (t.message?.length || 0) > 60 ? "..." : "";

        // Determine sender: TVV or Lead?
        const lastMsgMs = t.last_message_at ? new Date(t.last_message_at).getTime() : 0;
        const lastCustomerMs = t.last_message_by_customer_at ? new Date(t.last_message_by_customer_at).getTime() : 0;
        const senderIsStaff = lastMsgMs > 0 && lastCustomerMs > 0 && lastMsgMs > lastCustomerMs;
        // OR: if no customer time at all → assume TVV broadcast
        const noCustomerMsg = lastMsgMs > 0 && lastCustomerMs === 0;
        const eventType = senderIsStaff || noCustomerMsg ? "chat_staff" : "chat";
        const titlePrefix = eventType === "chat_staff" ? "TVV chat" : "Chat";

        return {
          lead_id: matchMap.get(t.id)!,
          source: "smax",
          event_type: eventType,
          title: `${titlePrefix}: ${msg}${ellipsis}`,
          detail: t.message || null,
          occurred_at: t.last_message_at || t.last_message_by_customer_at || new Date().toISOString(),
          payload: {
            thread_id: t.id,
            tid: t.tid,
            page_pid: t.page_pid,
            platform: t.platform,
            tag_aliases: t.tag_aliases || [],
            customer_name: customer?.name || customer?.profile_name,
            sender_is_staff: senderIsStaff || noCustomerMsg,
            last_msg_at: t.last_message_at,
            last_customer_msg_at: t.last_message_by_customer_at,
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
