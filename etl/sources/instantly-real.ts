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

function mapUeTypeToEvent(ueType: number | undefined): string {
  switch (ueType) {
    case 1: return "email_sent";
    case 3: return "email_reply";
    default: return "email_sent";
  }
}

// Rate limit: Instantly allow 20 req/min → throttle ~5s mỗi request
// (slightly under 12 req/min, leaves headroom for /leads + /emails alternating)
let lastFetchAt = 0;
const FETCH_INTERVAL_MS = 5000;

async function instantlyFetch(path: string, params: Record<string, string> = {}) {
  if (!API_KEY) throw new Error("Thiếu INSTANTLY_API_KEY");

  // Throttle
  const wait = lastFetchAt + FETCH_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();

  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  // Retry on 429 (rate limit)
  if (res.status === 429) {
    console.log(`   ⏸️  Rate limit hit, đợi 60s...`);
    await new Promise((r) => setTimeout(r, 60_000));
    return instantlyFetch(path, params);
  }

  // Retry on 5xx (server error tạm thời) với exponential backoff
  // Bumped to 5 retries with longer waits for stubborn server-side issues
  if (res.status >= 500 && res.status < 600) {
    const retries = (params._retry ? Number(params._retry) : 0);
    if (retries < 5) {
      const wait = (retries + 1) * 15_000; // 15s, 30s, 45s, 60s, 75s
      console.log(`   ⏸️  Server error ${res.status}, retry ${retries + 1}/5 sau ${wait/1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
      return instantlyFetch(path, { ...params, _retry: String(retries + 1) });
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
      const resp: { items?: InstantlyLead[]; next_starting_after?: string } =
        await instantlyFetch("/leads", params);
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
  } else {
    await admin.from("etl_state").upsert(
      { source: "instantly", key: "emails_cursor", value: cursor, updated_at: new Date().toISOString() },
      { onConflict: "source,key" }
    );
  }
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
    const leadsMapPromise = pullInstantlyLeadsMap();

    // 3. Pull /emails with pagination + RESUME from saved cursor.
    // On 5xx error, save progress and break gracefully — next run resumes.
    const collected: InstantlyEmail[] = [];
    let cursor: string | undefined = await loadInstantlyCursor();
    let page = 0;
    const MAX_PAGES = 1000;
    let failedAt: string | undefined;

    if (cursor) {
      console.log(`   ↻  Resuming from saved cursor (page ${page})`);
    }

    while (page < MAX_PAGES) {
      const params: Record<string, string> = { limit: "100" };
      if (cursor) params.starting_after = cursor;

      let resp: { items?: InstantlyEmail[]; next_starting_after?: string };
      try {
        resp = await instantlyFetch("/emails", params);
      } catch (err) {
        const msg = (err as Error).message;
        console.warn(`   ⚠️ Page ${page} failed after retries: ${msg.slice(0, 120)}`);
        console.warn(`   📍 Saving cursor for next resume...`);
        failedAt = cursor;
        break;
      }

      const items = resp.items || [];
      collected.push(...items);
      page++;

      // Save cursor every 10 pages so partial progress isn't lost
      if (page % 10 === 0 && resp.next_starting_after) {
        await saveInstantlyCursor(resp.next_starting_after);
        console.log(`   💾 Cursor checkpointed at page ${page} (${collected.length} emails so far)`);
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

    if (failedAt) {
      await saveInstantlyCursor(failedAt);
      console.log(`   📍 Cursor saved at ${failedAt.slice(0, 8)}... — re-run ETL to resume`);
    }

    const inRange = collected.filter((e) => {
      const t = new Date(e.timestamp_email || 0).getTime();
      return t >= sinceMs;
    });

    console.log(`📦 [Instantly] Pull ${collected.length} emails (${page} pages), ${inRange.length} mới trong khoảng incremental`);

    const leadsMap = await leadsMapPromise;

    if (inRange.length === 0) {
      await admin
        .from("sync_job")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          records_in: 0,
          records_merged: 0,
        })
        .eq("id", jobId);
      console.log("✅ Không có email mới — DB đã up-to-date");
      return { inserted: 0, jobId };
    }

    // 4. Identity match + auto-create (với name enrichment)
    const recordsForMatch = inRange.map((e) => {
      const email = (e.lead || e.to_address_email_list?.split(",")[0] || "").toLowerCase().trim();
      const enrichment = leadsMap.get(email);
      return {
        id: e.id,
        email,
        name: enrichment?.fullName,
        phone: enrichment?.phone,
      };
    });
    const matches = await batchResolveOrCreate(recordsForMatch, { source: "instantly" });
    logMatches(matches, "Instantly REAL");

    // 5. Update tên cho lead cũ nếu có name mới đẹp hơn
    const updates: Array<{ leadId: string; fullName: string }> = [];
    for (const m of matches) {
      if (m.matchedBy === "email" || m.matchedBy === "phone") {
        const rec = recordsForMatch.find((r) => r.id === m.rawId);
        if (rec?.name && m.leadId) {
          updates.push({ leadId: m.leadId, fullName: rec.name });
        }
      }
    }
    if (updates.length > 0) {
      console.log(`   ↳ Update tên cho ${updates.length} lead cũ`);
      // Batch update
      for (const u of updates) {
        await admin
          .from("dim_lead")
          .update({ full_name: u.fullName })
          .eq("lead_id", u.leadId)
          .or(`full_name.is.null,full_name.like.%@%,full_name.eq.${u.fullName.split(" ")[0]}`);
      }
    }

    // 6. Insert touchpoints
    const matchMap = new Map(matches.map((m) => [m.rawId, m.leadId]));
    const touchpoints = inRange
      .filter((e) => matchMap.get(e.id))
      .map((e) => ({
        lead_id: matchMap.get(e.id)!,
        source: "instantly",
        event_type: mapUeTypeToEvent(e.ue_type),
        title: e.ue_type === 3
          ? `Phản hồi email: ${e.subject || "(no subject)"}`
          : `Đã gửi email: ${e.subject || "(no subject)"}`,
        detail: null,
        occurred_at: e.timestamp_email || e.timestamp_created || new Date().toISOString(),
        payload: {
          subject: e.subject,
          campaign_id: e.campaign_id,
          ue_type: e.ue_type,
          from: e.from_address_email,
          real: true,
        },
      }));

    if (touchpoints.length > 0) {
      // Dedupe by raw_id để tránh insert lặp khi chạy nhiều lần
      const { data: existing } = await admin
        .from("fact_touchpoint")
        .select("payload")
        .eq("source", "instantly");
      const existingRawIds = new Set(
        (existing || [])
          .map((e) => (e.payload as { raw_id?: string })?.raw_id)
          .filter(Boolean) as string[]
      );

      const newTouchpoints = touchpoints.filter(
        (t) => !existingRawIds.has((t.payload as { raw_id: string }).raw_id)
      );
      const skipped = touchpoints.length - newTouchpoints.length;
      if (skipped > 0) {
        console.log(`   ↳ Skip ${skipped} touchpoint đã tồn tại (dedupe by raw_id)`);
      }

      if (newTouchpoints.length > 0) {
        const { error } = await admin.from("fact_touchpoint").insert(newTouchpoints);
        if (error) throw new Error(`Insert fact_touchpoint: ${error.message}`);
      }
    }

    await admin
      .from("sync_job")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_in: inRange.length,
        records_merged: touchpoints.length,
      })
      .eq("id", jobId);

    console.log(`✅ [Instantly REAL] Insert ${touchpoints.length} fact_touchpoint`);
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
