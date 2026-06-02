import { admin } from "../lib/supabase-admin";

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";

type SmaxMessage = {
  id: string;
  tid: string;
  page_pid: string;
  platform: string;
  message?: string;
  type?: string;
  sender_pid?: string;
  created_at?: string;
  _created_at?: string;
  zaloweb?: { attachments?: unknown[] };
  facebook?: { attachments?: unknown[] };
  instagram?: { attachments?: unknown[] };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NULL_BYTE = String.fromCharCode(0);

function sanitize(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .split(NULL_BYTE).join("")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function safeSlice(s: string, maxChars: number): string {
  const arr = Array.from(s);
  return arr.length > maxChars ? arr.slice(0, maxChars).join("") : s;
}

async function smaxGet(path: string) {
  if (!TOKEN) throw new Error("Thiếu SMAX_USER_TOKEN");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`SMAX ${res.status}: ${(await res.text()).slice(0, 100)}`);
  return res.json();
}

function hasAttachments(msg: SmaxMessage): boolean {
  const platforms = [msg.zaloweb, msg.facebook, msg.instagram];
  return platforms.some((p) => Array.isArray(p?.attachments) && p.attachments.length > 0);
}

function classifyMessage(msg: SmaxMessage): "chat" | "chat_staff" | "attachment" {
  if (hasAttachments(msg)) return "attachment";
  if (msg.sender_pid && msg.page_pid && msg.sender_pid === msg.page_pid) {
    return "chat_staff";
  }
  return "chat";
}

function formatTitle(msg: SmaxMessage, type: string): string {
  const text = (msg.message || "").trim();
  const codePoints = Array.from(text);
  const shortText = safeSlice(text, 80);
  const ellipsis = codePoints.length > 80 ? "..." : "";

  if (type === "attachment") {
    return text ? `📎 ${shortText}${ellipsis}` : "📎 Đã gửi tệp/ảnh";
  }
  if (type === "chat_staff") return `TVV: ${shortText}${ellipsis}`;
  return `Khách: ${shortText}${ellipsis}`;
}

export async function pullSmaxMessages() {
  console.log("📡 [SMAX Messages] Pull full message history...");

  const { data: jobData, error: jobErr } = await admin
    .from("sync_job")
    .insert({ source: "smax", status: "running", records_in: 0, records_merged: 0 })
    .select()
    .single();
  if (jobErr) throw new Error(`sync_job: ${jobErr.message}`);
  const jobId = jobData.id;

  try {
    const { data: existingTouchpoints } = await admin
      .from("fact_touchpoint")
      .select("lead_id, payload")
      .eq("source", "smax");

    type ThreadInfo = { lead_id: string; page_pid: string; tid: string };
    const threadMap = new Map<string, ThreadInfo>();
    const existingMessageIds = new Set<string>();

    for (const t of existingTouchpoints || []) {
      const payload = t.payload as Record<string, unknown>;
      const tid = payload?.tid as string | undefined;
      const page_pid = payload?.page_pid as string | undefined;
      const message_id = payload?.message_id as string | undefined;
      const thread_id = payload?.thread_id as string | undefined;

      if (message_id) existingMessageIds.add(message_id);

      const key = (tid || thread_id) ?? "";
      if (key && page_pid && !threadMap.has(key)) {
        threadMap.set(key, { lead_id: t.lead_id, page_pid, tid: tid || thread_id || "" });
      }
    }

    const threads = Array.from(threadMap.values()).filter((t) => t.tid && t.page_pid);
    console.log(`   ↳ Threads đã match có sẵn: ${threads.length}`);
    console.log(`   ↳ Messages đã pull (dedup): ${existingMessageIds.size}`);

    if (threads.length === 0) {
      await admin
        .from("sync_job")
        .update({ status: "success", finished_at: new Date().toISOString(), records_in: 0, records_merged: 0 })
        .eq("id", jobId);
      console.log("⚠️  Không có thread nào để pull messages. Chạy `npm run etl:smax:real` trước.");
      return { inserted: 0, jobId };
    }

    const BATCH = 10;
    const DELAY_MS = 200;
    const allTouchpoints: Array<{
      lead_id: string;
      source: string;
      event_type: string;
      title: string;
      detail: string | null;
      occurred_at: string;
      payload: Record<string, unknown>;
    }> = [];

    let processed = 0;
    let totalMessages = 0;
    let totalSkipped = 0;

    for (let i = 0; i < threads.length; i += BATCH) {
      const batch = threads.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map((t) =>
          smaxGet(`/bizs/${BIZ_SLUG}/pages/${t.page_pid}/threads/${t.tid}/messages?sort=-created_at&limit=20`)
        )
      );

      results.forEach((r, idx) => {
        const thread = batch[idx];
        if (r.status === "rejected") return;
        const messages = (r.value?.data || []) as SmaxMessage[];
        totalMessages += messages.length;

        for (const m of messages) {
          if (!m.id) continue;
          if (existingMessageIds.has(m.id)) {
            totalSkipped++;
            continue;
          }
          existingMessageIds.add(m.id);

          const hasText = (m.message || "").trim().length > 0;
          const hasAttach = hasAttachments(m);
          if (!hasText && !hasAttach) continue;

          const type = classifyMessage(m);
          const cleanMessage = sanitize(m.message);
          const cleanTitle = sanitize(formatTitle({ ...m, message: cleanMessage }, type));

          allTouchpoints.push({
            lead_id: thread.lead_id,
            source: "smax",
            event_type: type,
            title: cleanTitle,
            detail: cleanMessage || null,
            occurred_at: m.created_at || m._created_at || new Date().toISOString(),
            payload: {
              message_id: sanitize(m.id),
              tid: sanitize(m.tid),
              page_pid: sanitize(m.page_pid),
              platform: sanitize(m.platform),
              sender_pid: sanitize(m.sender_pid),
              has_attachments: hasAttach,
              real: true,
            },
          });
        }
      });

      processed += batch.length;
      if (processed % 100 === 0 || processed >= threads.length) {
        console.log(`   ↳ Progress: ${processed}/${threads.length} threads · ${allTouchpoints.length} touchpoints mới`);
      }
      await sleep(DELAY_MS);
    }

    console.log(`📦 [SMAX Messages] Pull ${totalMessages} messages từ ${threads.length} threads`);
    console.log(`   ↳ Skip ${totalSkipped} message đã có trong DB`);
    console.log(`   ↳ ${allTouchpoints.length} touchpoint MỚI để insert`);

    let inserted = 0;
    let failed = 0;
    const INSERT_BATCH = 100;
    for (let i = 0; i < allTouchpoints.length; i += INSERT_BATCH) {
      const batch = allTouchpoints.slice(i, i + INSERT_BATCH);
      const { error } = await admin.from("fact_touchpoint").insert(batch);
      if (error) {
        for (const tp of batch) {
          const { error: e } = await admin.from("fact_touchpoint").insert([tp]);
          if (!e) inserted++;
          else failed++;
        }
        continue;
      }
      inserted += batch.length;
    }
    if (failed > 0) console.log(`   ⚠️ ${failed} touchpoint bị skip do data lỗi`);

    await admin
      .from("sync_job")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_in: totalMessages,
        records_merged: inserted,
      })
      .eq("id", jobId);

    console.log(`✅ [SMAX Messages] Insert ${inserted} fact_touchpoint`);
    return { inserted, jobId };
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
