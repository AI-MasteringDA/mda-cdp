import { admin } from "../lib/supabase-admin";
import { batchResolveOrCreate, logMatches } from "../lib/identity";

/**
 * Instantly REAL API connector — V2 /emails + /leads endpoints
 *
 * Improvements V2:
 *   1. Pull /leads để có firstName + lastName → tên đẹp
 *   2. Incremental sync: chỉ pull email từ last_sync_at trở đi
 *   3. Update tên cũ nếu lead đã tồn tại với tên dạng email-prefix
 */

const API_KEY = process.env.INSTANTLY_API_KEY;
const BASE_URL = process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2";

type InstantlyEmail = {
  id: string;
  timestamp_email?: string;
  timestamp_created?: string;
  subject?: string;
  lead?: string;
  campaign_id?: string;
  ue_type?: number;
  from_address_email?: string;
  to_address_email_list?: string;
};

type InstantlyLead = {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone?: string;
  // có thể tên field khác — fallback hết
  firstName?: string;
  lastName?: string;
  companyName?: string;
};

function buildFullName(lead: InstantlyLead): string | null {
  const first = lead.first_name || lead.firstName || "";
  const last = lead.last_name || lead.lastName || "";
  const full = `${first} ${last}`.trim();
  return full || null;
}

// Instantly ue_type mapping (email activity types):
// 1 = sent, 2 = opened, 3 = replied, 4 = clicked, 5 = bounced/failed
function mapUeTypeToEvent(ueType: number | undefined): string {
  switch (ueType) {
    case 1: return "email_sent";
    case 2: return "email_open";
    case 3: return "email_reply";
    case 4: return "email_click";
    case 5: return "email_bounce";
    default: return "email_sent";
  }
}

// Rate limit: Instantly allow 20 req/min → throttle ~5s mỗi request
// (slightly under 12 req/min, leaves headroom for /leads + /emails alternating)
let lastFetchAt = 0;
const FETCH_INTERVAL_MS = 5000;

async function instantlyFetch(
  path: string,
  params: Record<string, string> = {},
  method: "GET" | "POST" = "GET"
) {
  if (!API_KEY) throw new Error("Thiếu INSTANTLY_API_KEY");

  // Throttle
  const wait = lastFetchAt + FETCH_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();

  // Strip internal _retry from params before sending
  const cleanParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith("_")) cleanParams[k] = v;
  }

  let url: string;
  let body: string | undefined;
  if (method === "POST") {
    url = `${BASE_URL}${path}`;
    body = JSON.stringify(cleanParams);
  } else {
    const u = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(cleanParams)) u.searchParams.set(k, v);
    url = u.toString();
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });

  // Retry on 429 (rate limit)
  if (res.status === 429) {
    console.log(`   ⏸️  Rate limit hit, đợi 60s...`);
    await new Promise((r) => setTimeout(r, 60_000));
    return instantlyFetch(path, params, method);
  }

  // Retry on 5xx (server error tạm thời) với exponential backoff
  // Bumped to 5 retries with longer waits for stubborn server-side issues
  if (res.status >= 500 && res.status < 600) {
    const retries = (params._retry ? Number(params._retry) : 0);
    if (retries < 5) {
      const wait = (retries + 1) * 15_000; // 15s, 30s, 45s, 60s, 75s
      console.log(`   ⏸️  Server error ${res.status}, retry ${retries + 1}/5 sau ${wait/1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
      return instantlyFetch(path, { ...params, _retry: String(retries + 1) }, method);
    }
    console.warn(`   ❌ Gave up after 5 retries on ${path}`);
  }

  if (!res.ok) throw new Error(`Instantly API ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Pull /leads endpoint để build email → name map.
 * Dùng để enrich tên khi auto-create dim_lead.
 */
async function pullInstantlyLeadsMap(maxPages = 20): Promise<Map<string, { fullName: string; phone?: string }>> {
  console.log("   ↳ Pulling /leads endpoint to enrich names...");
  const map = new Map<string, { fullName: string; phone?: string }>();
  let cursor: string | undefined;
  let page = 0;

  while (page < maxPages) {
    const params: Record<string, string> = { limit: "100" };
    if (cursor) params.starting_after = cursor;

    try {
      // Instantly v2 changed /leads (GET) → /leads/list (POST)
      const resp: { items?: InstantlyLead[]; next_starting_after?: string } =
        await instantlyFetch("/leads/list", params, "POST");
      const items = resp.items || [];

      for (const l of items) {
        const email = l.email?.toLowerCase().trim();
        if (!email) continue;
        const fullName = buildFullName(l);
        if (fullName) {
          map.set(email, { fullName, phone: l.phone });
        }
      }

      page++;
      if (!resp.next_starting_after || items.length === 0) break;
      cursor = resp.next_starting_after;
    } catch (e) {
      console.warn(`   ⚠️  /leads page ${page} lỗi: ${e}`);
      break;
    }
  }

  console.log(`   ↳ Map ${map.size} email → name`);
  return map;
}

/**
 * Cursor persistence — saved in `etl_state` table so we can resume after 500 errors.
 */
async function loadInstantlyCursor(): Promise<string | undefined> {
  const { data } = await admin
    .from("etl_state")
    .select("value")
    .eq("source", "instantly")
    .eq("key", "emails_cursor")
    .maybeSingle();
  return (data?.value as string) || undefined;
}

async function saveInstantlyCursor(cursor: string | null): Promise<void> {
  if (cursor === null) {
    await admin.from("etl_state").delete()
      .eq("source", "instantly").eq("key", "emails_cursor");
    // Reset failure counter when cursor cleared
    await admin.from("etl_state").delete()
      .eq("source", "instantly").eq("key", "cursor_fail_count");
  } else {
    await admin.from("etl_state").upsert(
      { source: "instantly", key: "emails_cursor", value: cursor, updated_at: new Date().toISOString() },
      { onConflict: "source,key" }
    );
  }
}

/**
 * Persisted cross-run fail counter for the current saved cursor.
 * After CURSOR_FAIL_GIVEUP failures, the next sync will clear cursor & start fresh
 * — prevents the cron from looping forever on a single bad page.
 */
const CURSOR_FAIL_GIVEUP = 3;

async function getCursorFailCount(): Promise<number> {
  const { data } = await admin
    .from("etl_state")
    .select("value")
    .eq("source", "instantly")
    .eq("key", "cursor_fail_count")
    .maybeSingle();
  const v = data?.value;
  return typeof v === "string" ? Number(v) || 0 : 0;
}

async function setCursorFailCount(n: number): Promise<void> {
  await admin.from("etl_state").upsert(
    { source: "instantly", key: "cursor_fail_count", value: String(n), updated_at: new Date().toISOString() },
    { onConflict: "source,key" }
  );
}

/**
 * Tìm thời điểm sync thành công gần nhất.
 * Dùng làm cutoff cho incremental pull.
 */
async function getLastSuccessfulSync(): Promise<Date> {
  // Force full backfill nếu INSTANTLY_FULL_BACKFILL=true
  if (process.env.INSTANTLY_FULL_BACKFILL === "true") {
    const daysBack = Number(process.env.INSTANTLY_DAYS_BACK || 365);
    console.log(`   ⚙️  FULL BACKFILL mode: ${daysBack} ngày`);
    return new Date(Date.now() - daysBack * 24 * 3600_000);
  }

  const { data } = await admin
    .from("sync_job")
    .select("started_at")
    .eq("source", "instantly")
    .eq("status", "success")
    .gt("records_merged", 0)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.started_at) {
    return new Date(data.started_at);
  }
  const daysBack = Number(process.env.INSTANTLY_DAYS_BACK || 7);
  return new Date(Date.now() - daysBack * 24 * 3600_000);
}

/**
 * Process a batch of emails: identity resolve + insert touchpoints.
 * Runs during pagination so partial progress is persisted to DB.
 */
async function processBatch(
  batch: InstantlyEmail[],
  sinceMs: number,
  leadsMap: Map<string, { fullName: string; phone?: string }>,
  existingRawIds: Set<string>
): Promise<{ inserted: number; created: number }> {
  const inRange = batch.filter((e) => {
    const t = new Date(e.timestamp_email || 0).getTime();
    return t >= sinceMs;
  });
  if (inRange.length === 0) return { inserted: 0, created: 0 };

  const recordsForMatch = inRange.map((e) => {
    const email = (e.lead || e.to_address_email_list?.split(",")[0] || "").toLowerCase().trim();
    const enrichment = leadsMap.get(email);
    return { id: e.id, email, name: enrichment?.fullName, phone: enrichment?.phone };
  });
  const matches = await batchResolveOrCreate(recordsForMatch, { source: "instantly" });
  const matchMap = new Map(matches.map((m) => [m.rawId, m.leadId]));
  const created = matches.filter((m) => m.matchedBy === "created").length;

  const touchpoints = inRange
    .filter((e) => matchMap.get(e.id) && !existingRawIds.has(e.id))
    .map((e) => ({
      lead_id: matchMap.get(e.id)!,
      source: "instantly",
      event_type: mapUeTypeToEvent(e.ue_type),
      title: e.ue_type === 3
        ? `Phản hồi email: ${e.subject || "(no subject)"}`
        : e.ue_type === 2
        ? `Đã mở email: ${e.subject || "(no subject)"}`
        : e.ue_type === 4
        ? `Đã click email: ${e.subject || "(no subject)"}`
        : `Đã gửi email: ${e.subject || "(no subject)"}`,
      detail: null,
      occurred_at: e.timestamp_email || e.timestamp_created || new Date().toISOString(),
      payload: {
        raw_id: e.id, // ← critical for dedupe
        subject: e.subject,
        campaign_id: e.campaign_id,
        ue_type: e.ue_type,
        from: e.from_address_email,
        real: true,
      },
    }));

  if (touchpoints.length > 0) {
    const { error } = await admin.from("fact_touchpoint").insert(touchpoints);
    if (error) throw new Error(`Insert fact_touchpoint: ${error.message}`);
    // Track for next batches in this run
    for (const t of touchpoints) {
      existingRawIds.add((t.payload as { raw_id: string }).raw_id);
    }
  }
  return { inserted: touchpoints.length, created };
}

export async function pullFromInstantlyReal() {
  console.log("📡 [Instantly REAL] Đang gọi API thật...");

  const { data: jobData, error: jobErr } = await admin
    .from("sync_job")
    .insert({ source: "instantly", status: "running", records_in: 0, records_merged: 0 })
    .select()
    .single();
  if (jobErr) throw new Error(`Tạo sync_job: ${jobErr.message}`);
  const jobId = jobData.id;

  try {
    // 1. Determine cutoff (incremental sync)
    const lastSync = await getLastSuccessfulSync();
    const sinceMs = lastSync.getTime();
    console.log(`   ↳ Incremental sync: lấy email từ ${lastSync.toISOString().slice(0, 19)} trở đi`);

    // 2. Pull /leads parallel để enrich names
    const leadsMap = await pullInstantlyLeadsMap();

    // Pre-load existing raw_ids for dedupe (single fetch, then track in-memory)
    console.log("   ↳ Loading existing Instantly raw_ids for dedupe...");
    const existingRawIds = new Set<string>();
    {
      let fromRow = 0;
      while (true) {
        const { data } = await admin
          .from("fact_touchpoint")
          .select("payload")
          .eq("source", "instantly")
          .range(fromRow, fromRow + 999);
        if (!data || data.length === 0) break;
        for (const t of data) {
          const rawId = (t.payload as { raw_id?: string })?.raw_id;
          if (rawId) existingRawIds.add(rawId);
        }
        if (data.length < 1000) break;
        fromRow += 1000;
      }
    }
    console.log(`   ↳ ${existingRawIds.size} email đã có trong DB → sẽ skip dedupe`);

    // 3. Pull /emails with pagination + RESUME from saved cursor.
    // INSERT IN BATCHES every BATCH_PAGES — survives Ctrl+C, timeout, 5xx.
    const BATCH_PAGES = 10; // insert every 1000 emails
    let pendingBatch: InstantlyEmail[] = [];
    let cursor: string | undefined = await loadInstantlyCursor();
    let page = 0;
    let totalCollected = 0;
    let totalInserted = 0;
    let totalCreated = 0;
    const MAX_PAGES = 1000;
    let failedAt: string | undefined;

    if (cursor) {
      console.log(`   ↻  Resuming from saved cursor (page ${page})`);
    }

    // Before starting: if we've failed CURSOR_FAIL_GIVEUP times on this same cursor
    // across previous runs, clear the cursor and start fresh.
    if (cursor) {
      const prevFails = await getCursorFailCount();
      if (prevFails >= CURSOR_FAIL_GIVEUP) {
        console.warn(`   ❌ Cursor ${cursor.slice(0, 12)} failed ${prevFails}× across previous runs — clearing & starting fresh`);
        await saveInstantlyCursor(null);
        cursor = undefined;
      }
    }

    while (page < MAX_PAGES) {
      const params: Record<string, string> = { limit: "100" };
      if (cursor) params.starting_after = cursor;

      let resp: { items?: InstantlyEmail[]; next_starting_after?: string };
      try {
        resp = await instantlyFetch("/emails", params);
      } catch (err) {
        const msg = (err as Error).message;
        console.warn(`   ⚠️ Page ${page} (cursor ${cursor?.slice(0, 12) || "-"}) failed: ${msg.slice(0, 120)}`);
        failedAt = cursor;
        break;
      }

      const items = resp.items || [];
      pendingBatch.push(...items);
      totalCollected += items.length;
      page++;

      // INSERT BATCH every N pages + save cursor
      if (page % BATCH_PAGES === 0 && pendingBatch.length > 0) {
        const { inserted, created } = await processBatch(pendingBatch, sinceMs, leadsMap, existingRawIds);
        totalInserted += inserted;
        totalCreated += created;
        pendingBatch = [];
        if (resp.next_starting_after) {
          await saveInstantlyCursor(resp.next_starting_after);
        }
        console.log(`   💾 Inserted batch page ${page}: +${inserted} touchpoints (+${created} new leads) | total ${totalInserted}`);
      }

      const oldestTs = items.length > 0
        ? Math.min(...items.map((i) => new Date(i.timestamp_email || 0).getTime()))
        : 0;
      if (oldestTs > 0 && oldestTs < sinceMs) {
        // Reached historical cutoff — done, clear saved cursor
        await saveInstantlyCursor(null);
        console.log(`   ✓ Hit historical cutoff, cursor cleared`);
        break;
      }
      if (!resp.next_starting_after || items.length === 0) {
        await saveInstantlyCursor(null);
        console.log(`   ✓ Reached end of feed, cursor cleared`);
        break;
      }
      cursor = resp.next_starting_after;
    }

    // Flush remaining batch after loop ends
    if (pendingBatch.length > 0) {
      const { inserted, created } = await processBatch(pendingBatch, sinceMs, leadsMap, existingRawIds);
      totalInserted += inserted;
      totalCreated += created;
      console.log(`   💾 Final flush: +${inserted} touchpoints (+${created} new leads)`);
    }

    if (failedAt) {
      await saveInstantlyCursor(failedAt);
      // Increment cross-run failure counter; auto-clear after CURSOR_FAIL_GIVEUP
      const prevFails = await getCursorFailCount();
      const nextFails = prevFails + 1;
      await setCursorFailCount(nextFails);
      console.log(`   📍 Cursor saved at ${failedAt} (fail ${nextFails}/${CURSOR_FAIL_GIVEUP}) — re-run ETL to resume`);
    } else {
      // Successful run — reset counter
      await setCursorFailCount(0);
    }

    console.log(`📦 [Instantly] Pulled ${totalCollected} emails (${page} pages), inserted ${totalInserted} new touchpoints (+${totalCreated} leads)`);

    await admin
      .from("sync_job")
      .update({
        // Partial success: if we inserted something, mark success even with leftover cursor
        status: failedAt && totalInserted === 0 ? "failed" : "success",
        finished_at: new Date().toISOString(),
        records_in: totalCollected,
        records_merged: totalInserted,
        error_message: failedAt
          ? `Sync dừng tại cursor ${failedAt} — lần sau resume từ đây`
          : null,
      })
      .eq("id", jobId);

    console.log(`✅ [Instantly REAL] Insert ${totalInserted} fact_touchpoint`);
    return { inserted: totalInserted, jobId };
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
