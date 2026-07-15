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

/**
 * Extract email + VN phone from arbitrary text. Handles all observed patterns:
 *   "Name_email@x.com"           → email
 *   "Name_+84 869 689 105"       → phone 0869689105
 *   "Name_0978 31 41 22"         → phone 0978314122
 *   "Name_0912345678"            → phone 0912345678
 *   "K39- Lộc-937144709"         → phone 0937144709 (bare 9-digit)
 * Strips whitespace/dashes/parens before phone matching. +84 → 0 normalized.
 */
function scanEmailPhone(...texts: (string | null | undefined)[]) {
  const joined = texts.filter(Boolean).join(" ");

  // Treat "_" as separator (MDA TVV format "Name_email@x.com") so regex doesn't
  // greedily eat "Name_" into the email's local part.
  const emailMatch = joined.replace(/_/g, " ").match(/[a-zA-Z0-9.%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch?.[0]?.toLowerCase() || null;

  const cleaned = joined.replace(/[\s\-()]/g, "");
  let phoneMatch: RegExpMatchArray | null =
    cleaned.match(/\+84(3|5|7|8|9)\d{8}/) ||
    cleaned.match(/0(3|5|7|8|9)\d{8}/) ||
    cleaned.match(/(?<!\d)(3|5|7|8|9)\d{8}(?!\d)/);
  let phone: string | null = null;
  if (phoneMatch) {
    phone = phoneMatch[0].replace(/^\+84/, "0");
    if (phone.length === 9) phone = "0" + phone;
  }

  return { email, phone };
}

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    // Common shapes: { phone: "..." }, { email: "..." }, { value: "..." }
    return toStringOrNull(obj.phone ?? obj.email ?? obj.value ?? obj.number ?? null);
  }
  return null;
}

// Strip null bytes + lone UTF-16 surrogates that Postgres rejects as invalid
// JSON ("invalid input syntax for type json"). Chat messages from Zalo/FB
// occasionally carry these (broken emoji, control chars).
const NULL_BYTE = String.fromCharCode(0);
function sanitizeText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .split(NULL_BYTE).join("")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

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

async function smaxPost(path: string, body: unknown, retries = 3): Promise<unknown> {
  if (!TOKEN) throw new Error("Thiếu SMAX_USER_TOKEN / SMAX_API_KEY trong .env.local");
  let lastErr: string = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
        lastErr = `SMAX API ${res.status}`;
        if (attempt < retries) {
          const wait = 2000 * (attempt + 1);
          console.log(`   ⏳ ${lastErr}, retry in ${wait}ms (attempt ${attempt + 1}/${retries})`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
      }
      if (!res.ok) throw new Error(`SMAX API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    } catch (e) {
      lastErr = (e as Error).message;
      if (attempt < retries && (lastErr.includes("fetch") || lastErr.includes("502") || lastErr.includes("timeout"))) {
        const wait = 2000 * (attempt + 1);
        console.log(`   ⏳ Network error, retry in ${wait}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  throw new Error(`SMAX API failed after ${retries} retries: ${lastErr}`);
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
    // Cutoff modes:
    //  - SMAX_LOOKBACK_DAYS=365 → BACKFILL: pull threads with last_message_at > now-365d
    //  - Otherwise INCREMENTAL: cutoff = last SMAX touchpoint's occurred_at
    let cutoffMs = 0;
    const lookbackDays = Number(process.env.SMAX_LOOKBACK_DAYS || 0);
    if (lookbackDays > 0) {
      cutoffMs = Date.now() - lookbackDays * 86400_000;
      console.log(`   ⚙️  BACKFILL mode: pulling last ${lookbackDays} days (since ${new Date(cutoffMs).toISOString().slice(0, 10)})`);
    } else {
      const { data: lastTp } = await admin
        .from("fact_touchpoint")
        .select("occurred_at")
        .eq("source", "smax")
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastTp?.occurred_at) {
        cutoffMs = new Date(lastTp.occurred_at).getTime();
        // 240-min overlap: a chat that lands seconds before the previous run's
        // cutoff (boundary case: Nhu Nguyen Hoang Khanh 2026-07-10 06:08Z) or
        // during an ETL outage would otherwise be skipped forever, since
        // merge-upsert no longer re-surfaces old threads by accident. Wide
        // overlap is cheap: re-pulled threads are idempotent upserts.
        const overlapMin = Number(process.env.SMAX_OVERLAP_MINUTES || 240);
        cutoffMs -= overlapMin * 60_000;
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
        const resp = await smaxPost(
          `/bizs/${BIZ_SLUG}/threads`,
          { page_pids: [pagePid], skip, limit: LIMIT }
        ) as { data?: SmaxThread[]; total?: number };
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

    // ═══════════════════════════════════════════════════════════════════════
    // Supplementary pull via /customers endpoint (up to 10k customers, ~14 months)
    // /threads endpoint is capped at ~700 unique threads regardless of pagination.
    // /customers exposes the full customer DB — fills the gap for historic data.
    // ═══════════════════════════════════════════════════════════════════════
    type SmaxCustomer = {
      id: string;
      name?: string;
      profile_name?: string;
      // SMAX API returns email/phone as SINGULAR strings on the customer object
      // (verified against real payload). The plural arrays exist too but are
      // almost always empty. Reading only the plurals silently lost contact
      // info for most SMAX-sourced leads.
      email?: string;
      phone?: string;
      emails?: string[];
      phones?: string[];
      platform?: string;
      page_pid?: string;
      pid?: string;
      picture?: string;
      created_at?: string;
      updated_at?: string;
      interaction?: { first?: string; last?: string };
      tags?: (string | { id?: string; name?: string; alias?: string; time?: string })[];
    };
    const CUSTOMER_SIZE = Number(process.env.SMAX_CUSTOMER_SIZE || 10000);
    // Incremental runs only need customers whose last interaction is newer than
    // the cutoff — processing all 9k+ historic customers EVERY run was the
    // single biggest Disk-IO burner (9k identity lookups × every 5 minutes).
    // Backfill mode (SMAX_LOOKBACK_DAYS set / empty DB) still takes the full window.
    const customerLookbackDays = lookbackDays || 365;
    const customerCutoffMs = cutoffMs > 0
      ? cutoffMs
      : Date.now() - customerLookbackDays * 86400_000;
    console.log(`   ↳ Pulling /customers (size=${CUSTOMER_SIZE}, filter interaction.last > ${new Date(customerCutoffMs).toISOString().slice(0, 19)})...`);
    const custRes = await smaxPost(`/bizs/${BIZ_SLUG}/customers`, { size: CUSTOMER_SIZE }) as { data?: SmaxCustomer[]; total?: number };
    const allCustomers = (custRes.data || []).filter((c) => {
      const t = c.interaction?.last || c.updated_at || c.created_at;
      return t ? new Date(t).getTime() >= customerCutoffMs : false;
    });
    console.log(`   ↳ /customers: ${custRes.data?.length || 0} pulled, ${allCustomers.length} past cutoff (SMAX total: ${custRes.total})`);

    // Identity resolution — merge threads + customers, with regex extraction
    // from name/message so "Nguyễn A_x@y.com" or "call me 0912345678" gets picked up.
    let regexEmailWin = 0;
    let regexPhoneWin = 0;

    const threadIdentityRecords = allThreads
      .filter((t) => t.customer)
      .map((t) => {
        const nativeEmail = toStringOrNull(t.customer?.email) || toStringOrNull(t.emails?.[0]);
        const nativePhone = toStringOrNull(t.customer?.phone) || toStringOrNull(t.phones?.[0]);
        const name = t.customer?.name || t.customer?.profile_name || null;
        const scanned = (!nativeEmail || !nativePhone)
          ? scanEmailPhone(name, t.message)
          : { email: null, phone: null };
        const email = nativeEmail || scanned.email;
        const phone = nativePhone || scanned.phone;
        if (!nativeEmail && scanned.email) regexEmailWin++;
        if (!nativePhone && scanned.phone) regexPhoneWin++;
        return {
          id: t.id,
          email,
          phone,
          name,
          smax_customer_id: t.customer?.id || null,
          external_platform: t.platform || null,
          external_profile_id: t.customer?.pid || null,
        };
      });

    const threadCustomerIds = new Set(allThreads.map((t) => t.customer?.id).filter(Boolean));
    const customerIdentityRecords = allCustomers
      .filter((c) => !threadCustomerIds.has(c.id))
      .map((c) => {
        // Prefer singular fields (that's where SMAX actually puts them); fall
        // back to plurals for any customer that does use the array shape.
        const nativeEmail = toStringOrNull(c.email) || toStringOrNull(c.emails?.[0]);
        const nativePhone = toStringOrNull(c.phone) || toStringOrNull(c.phones?.[0]);
        const name = c.name || c.profile_name || null;
        const scanned = (!nativeEmail || !nativePhone)
          ? scanEmailPhone(name)
          : { email: null, phone: null };
        const email = nativeEmail || scanned.email;
        const phone = nativePhone || scanned.phone;
        if (!nativeEmail && scanned.email) regexEmailWin++;
        if (!nativePhone && scanned.phone) regexPhoneWin++;
        return {
          id: `smax-cust-${c.id}`,
          email,
          phone,
          name,
          smax_customer_id: c.id,
          external_platform: c.platform || null,
          external_profile_id: c.pid || null,
        };
      });
    console.log(`   ↳ Regex extraction: +${regexEmailWin} emails, +${regexPhoneWin} phones from name/message`);

    const identityRecords = [...threadIdentityRecords, ...customerIdentityRecords];
    console.log(`   ↳ Identity records: ${threadIdentityRecords.length} threads + ${customerIdentityRecords.length} historic customers = ${identityRecords.length} total`);

    const matches = await batchResolveOrCreate(identityRecords, { source: "smax" });
    logMatches(matches, "SMAX REAL");

    const matchMap = new Map(matches.map((m) => [m.rawId, m.leadId]));

    // ═══════════════════════════════════════════════════════════════════════
    // Aggregate SMAX tags per lead
    // - customer.tags: array of objects {id, name, alias, time} → extract .name
    // - thread.tag_aliases: array of strings → keep as-is
    // Also map customer_id → leadId for customers that have BOTH a thread and tags
    // ═══════════════════════════════════════════════════════════════════════
    const customerIdToLeadId = new Map<string, string>();
    for (const t of allThreads) {
      if (t.customer?.id) {
        const lid = matchMap.get(t.id);
        if (lid) customerIdToLeadId.set(t.customer.id, lid);
      }
    }
    for (const c of allCustomers) {
      const lid = matchMap.get(`smax-cust-${c.id}`);
      if (lid) customerIdToLeadId.set(c.id, lid);
    }

    // Tag semantics: MIRROR SMAX exactly (overwrite, not union).
    // Rationale: user wants DB to reflect current SMAX state — if a customer's
    // tag changes from "Hot Lead" to "Cold Lead", DB must show "Cold Lead" only,
    // not both. So we include EVERY customer/thread we pulled (even those with
    // 0 tags → empty array → dim_lead.smax_tags will be reset to []).
    // Customers NOT in this ETL batch keep their existing tags (no update).
    const leadTagMap = new Map<string, Set<string>>();
    // Thời điểm gắn tag "Hot Lead" mới nhất cho mỗi lead. SMAX trả về
    // customer.tags[].time = khi Giàu bấm tag → giữ lại để lọc "nóng tính đến".
    const hotTagAtMap = new Map<string, string>();
    const isHotTag = (name: string) =>
      name.toLowerCase().replace(/[\s_-]/g, "") === "hotlead";
    const extractTagName = (raw: unknown): string | null => {
      if (!raw) return null;
      if (typeof raw === "string") return raw.trim() || null;
      if (typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        const name = obj.name ?? obj.alias ?? obj.tag_name;
        if (typeof name === "string") return name.trim() || null;
      }
      return null;
    };
    const tagTime = (raw: unknown): string | null => {
      if (raw && typeof raw === "object") {
        const t = (raw as Record<string, unknown>).time;
        if (typeof t === "string" && !isNaN(Date.parse(t))) return t;
      }
      return null;
    };

    for (const c of allCustomers) {
      const leadId = customerIdToLeadId.get(c.id);
      if (!leadId) continue;
      // Always initialize (even for 0 tags) so overwrite semantics work.
      if (!leadTagMap.has(leadId)) leadTagMap.set(leadId, new Set());
      const set = leadTagMap.get(leadId)!;
      for (const tag of c.tags ?? []) {
        const name = extractTagName(tag);
        if (!name) continue;
        set.add(name);
        if (isHotTag(name)) {
          const time = tagTime(tag);
          const prev = hotTagAtMap.get(leadId);
          if (time && (!prev || time > prev)) hotTagAtMap.set(leadId, time);
        }
      }
    }
    for (const t of allThreads) {
      if (!t.customer?.id) continue;
      const leadId = customerIdToLeadId.get(t.customer.id);
      if (!leadId) continue;
      if (!leadTagMap.has(leadId)) leadTagMap.set(leadId, new Set());
      const set = leadTagMap.get(leadId)!;
      for (const tag of t.tag_aliases ?? []) {
        const name = extractTagName(tag);
        if (name) set.add(name);
      }
    }

    // NOTE: smax_tags update is deferred to AFTER touchpoint insert so that even
    // if the tag update step is slow/killed, the chat data (fact_touchpoint) is
    // already safely in DB.

    // Historic-customer touchpoints (customers without a recent thread)
    // occurred_at = interaction.last (when they last chatted). No message text available.
    const customerTouchpoints = allCustomers
      .filter((c) => !threadCustomerIds.has(c.id))
      .map((c) => {
        const leadId = matchMap.get(`smax-cust-${c.id}`);
        if (!leadId) return null;
        const occurred = c.interaction?.last || c.updated_at || c.created_at || new Date().toISOString();
        const displayName = sanitizeText(c.name || c.profile_name) || "(anonymous)";
        return {
          lead_id: leadId,
          source: "smax",
          event_type: "chat" as const,
          title: `Chat: ${displayName.slice(0, 60)}`,
          detail: null as string | null,
          occurred_at: occurred,
          dedup_key: `cust-${c.id}`,
          payload: {
            thread_id: `cust-${c.id}`,
            smax_customer_id: c.id,
            page_pid: c.page_pid,
            platform: c.platform,
            tags: c.tags || [],
            customer_name: sanitizeText(c.name || c.profile_name),
            source_endpoint: "customers",
            interaction_first: c.interaction?.first,
            interaction_last: c.interaction?.last,
            real: true,
          },
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
    console.log(`   ↳ Built ${customerTouchpoints.length} historic-customer touchpoints`);

    // Build touchpoints (1 per thread)
    // CLASSIFY SENDER: compare last_message_at vs last_message_by_customer_at
    //   if last_message_at > last_message_by_customer_at → TVV/staff sent last → event_type='chat_staff'
    //   if equal or no staff time → customer sent last → event_type='chat'
    const touchpoints = allThreads
      .filter((t) => matchMap.get(t.id))
      .map((t) => {
        const customer = t.customer;
        const cleanMsg = sanitizeText(t.message);
        const msg = cleanMsg.slice(0, 60) || "(no message)";
        const ellipsis = cleanMsg.length > 60 ? "..." : "";

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
          detail: cleanMsg || null,
          occurred_at: t.last_message_at || t.last_message_by_customer_at || new Date().toISOString(),
          dedup_key: t.id,
          payload: {
            thread_id: t.id,
            tid: t.tid,
            page_pid: t.page_pid,
            platform: t.platform,
            tag_aliases: t.tag_aliases || [],
            customer_name: sanitizeText(customer?.name || customer?.profile_name),
            sender_is_staff: senderIsStaff || noCustomerMsg,
            last_msg_at: t.last_message_at,
            last_customer_msg_at: t.last_message_by_customer_at,
            real: true,
          },
        };
      });

    // Merge thread touchpoints + customer touchpoints
    const allTouchpoints = [...touchpoints, ...customerTouchpoints];

    if (allTouchpoints.length > 0) {
      // DB-level dedup via UNIQUE INDEX ux_ft_source_dedup(source, dedup_key).
      // MERGE semantics (not ignore!): one row per thread, refreshed in place.
      // When an EXISTING lead sends a new message, their thread's row gets the
      // new occurred_at/title/detail — that's what moves them to the top of
      // Lark. ignoreDuplicates froze existing threads at their first message
      // and only brand-new leads ever surfaced (bug caught by user 2026-07-10).
      const BATCH = 100;
      let upserted = 0;
      let failed = 0;
      for (let i = 0; i < allTouchpoints.length; i += BATCH) {
        const batch = allTouchpoints.slice(i, i + BATCH);
        const { data, error } = await admin
          .from("fact_touchpoint")
          .upsert(batch, { onConflict: "source,dedup_key" })
          .select("id");
        if (!error) { upserted += data?.length ?? 0; continue; }
        // A single bad row (invalid JSON despite sanitize) shouldn't sink the
        // whole batch — retry one-by-one so the rest still land.
        console.warn(`   ⚠️ batch ${i} failed (${error.message.slice(0, 80)}), retrying row-by-row...`);
        for (const tp of batch) {
          const { data: d1, error: e1 } = await admin
            .from("fact_touchpoint")
            .upsert([tp], { onConflict: "source,dedup_key" })
            .select("id");
          if (!e1) upserted += d1?.length ?? 0;
          else failed++;
        }
      }
      if (failed > 0) console.log(`   ⚠️ ${failed} touchpoint failed (bad data, skipped)`);
      console.log(`✅ [SMAX REAL] Upsert ${upserted} fact_touchpoint (mới + refresh) từ ${allThreads.length} threads + ${allCustomers.length} customers`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Update smax_tags on leads — deferred until AFTER touchpoint insert so
    // fact_touchpoint (chat data) is safely in DB even if this step is slow.
    // ═══════════════════════════════════════════════════════════════════════
    // MIRROR SMAX exactly: overwrite dim_lead.smax_tags with whatever SMAX
    // currently returns for each customer we touched. If SMAX now returns 0
    // tags for a customer that previously had "Hot Lead", we set tags = []
    // — DB must reflect current SMAX state, not accumulate history.
    // Read-first to skip no-op writes (no diff → don't touch the row).
    if (leadTagMap.size > 0) {
      const leadIds = Array.from(leadTagMap.keys());
      const existingTagsByLead = new Map<string, string[]>();
      const existingHotAt = new Map<string, string | null>();
      for (let i = 0; i < leadIds.length; i += 100) {
        const batch = leadIds.slice(i, i + 100);
        const { data } = await admin.from("dim_lead").select("lead_id, smax_tags, hot_tag_at").in("lead_id", batch);
        for (const row of data ?? []) {
          existingTagsByLead.set(row.lead_id, Array.isArray(row.smax_tags) ? row.smax_tags : []);
          existingHotAt.set(row.lead_id, (row as { hot_tag_at?: string | null }).hot_tag_at ?? null);
        }
      }

      const changed: { lead_id: string; smax_tags: string[]; hot_tag_at?: string }[] = [];
      for (const [lead_id, tagSet] of leadTagMap.entries()) {
        const smaxNow = Array.from(tagSet).sort();
        const existing = (existingTagsByLead.get(lead_id) ?? []).slice().sort();
        const sameLen = smaxNow.length === existing.length;
        const tagsSame = sameLen && smaxNow.every((t, i) => t === existing[i]);

        // hot_tag_at: chỉ tiến lên (giữ mốc mới nhất), không lùi/không xoá.
        const newHotAt = hotTagAtMap.get(lead_id);
        const curHotAt = existingHotAt.get(lead_id) ?? null;
        const hotAtChanged = !!newHotAt && (!curHotAt || newHotAt > curHotAt);

        if (tagsSame && !hotAtChanged) continue;
        const row: { lead_id: string; smax_tags: string[]; hot_tag_at?: string } = { lead_id, smax_tags: smaxNow };
        if (hotAtChanged) row.hot_tag_at = newHotAt;
        changed.push(row);
      }
      console.log(`   ↳ smax_tags mirror: ${leadTagMap.size} touched leads → ${changed.length} diffs → batch upserting...`);

      let updated = 0;
      const TAG_BATCH = 500;
      for (let i = 0; i < changed.length; i += TAG_BATCH) {
        const batch = changed.slice(i, i + TAG_BATCH);
        const { error } = await admin.from("dim_lead").upsert(batch, { onConflict: "lead_id" });
        if (!error) updated += batch.length;
        else console.warn(`   ⚠️ upsert batch ${i}: ${error.message.slice(0, 120)}`);
      }
      console.log(`   ✓ Upserted smax_tags on ${updated} leads (skipped ${leadTagMap.size - changed.length} unchanged)`);
    }

    await admin
      .from("sync_job")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_in: allThreads.length + allCustomers.length,
        records_merged: allTouchpoints.length,
      })
      .eq("id", jobId);

    return { inserted: allTouchpoints.length, jobId };
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
