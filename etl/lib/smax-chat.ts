/**
 * SMAX chat history → Lark text columns.
 *
 * Pulls a lead's full recent chat log straight from the SMAX messages API and
 * formats it into ≤5 chunks of ≤9,500 chars each (Lark text cells cap at 10k).
 * When a conversation exceeds the cap, the OLDEST messages are dropped — the
 * audit AI mostly needs recent context.
 *
 * Deliberately does NOT store messages in Supabase — SMAX stays the system of
 * record and we add zero Disk-IO load (see the 2026-07-10 IO incident).
 */

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";

export const CHAT_COL_COUNT = 5;
export const CHAT_COL_CHAR_LIMIT = 9500; // margin under Lark's 10k cap
export const CHAT_COL_NAMES = Array.from(
  { length: CHAT_COL_COUNT },
  (_, i) => `Chat History ${i + 1}`
);

const NULL_BYTE = String.fromCharCode(0);
function sanitize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .split(NULL_BYTE).join("")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

type SmaxApiMessage = {
  id?: string;
  message?: string;
  sender_pid?: string;
  page_pid?: string;
  created_at?: string;
  zaloweb?: { attachments?: unknown[] };
  facebook?: { attachments?: unknown[] };
  instagram?: { attachments?: unknown[] };
};

function hasAttachments(m: SmaxApiMessage): boolean {
  return [m.zaloweb, m.facebook, m.instagram].some(
    (p) => Array.isArray(p?.attachments) && p.attachments.length > 0
  );
}

/**
 * Fetch up to `maxMessages` most-recent messages for one SMAX thread.
 * Returns [] on any API error (a lead with a broken thread should not sink
 * the whole push run).
 */
async function fetchThreadMessages(
  pagePid: string,
  tid: string,
  maxMessages = 200
): Promise<Array<{ ts: string; staff: boolean; text: string }>> {
  if (!TOKEN) return [];
  const out: Array<{ ts: string; staff: boolean; text: string }> = [];
  const LIMIT = 100;
  let skip = 0;
  while (out.length < maxMessages) {
    let data: { data?: SmaxApiMessage[] };
    try {
      const res = await fetch(
        `${BASE}/bizs/${BIZ_SLUG}/pages/${pagePid}/threads/${tid}/messages?sort=-created_at&limit=${LIMIT}&skip=${skip}`,
        { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }
      );
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break;
    }
    const items = data.data || [];
    if (items.length === 0) break;
    for (const m of items) {
      const text = sanitize(m.message).trim();
      const attach = hasAttachments(m);
      if (!text && !attach) continue;
      out.push({
        ts: m.created_at || "",
        staff: !!(m.sender_pid && m.page_pid && m.sender_pid === m.page_pid),
        text: text || "[gửi ảnh/tệp]",
      });
    }
    if (items.length < LIMIT) break;
    skip += LIMIT;
  }
  return out.slice(0, maxMessages);
}

function fmtLine(m: { ts: string; staff: boolean; text: string }): string {
  // "[07/10 14:29] Khách: ..." — compact, chronological-friendly
  const d = m.ts ? new Date(m.ts) : null;
  const stamp = d && !isNaN(d.getTime())
    ? `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")} ${String((d.getUTCHours() + 7) % 24).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
    : "??/??";
  return `[${stamp}] ${m.staff ? "TVV" : "Khách"}: ${m.text}`;
}

/**
 * Build the chat-history column values for one lead.
 * `threads` = every (page_pid, tid) pair the lead has chatted on (a lead can
 * span multiple platforms/nicks). Messages are merged chronologically.
 *
 * Returns a map of { "Chat History 1": "...", ..., "Chat History 5": "..." } —
 * ALWAYS all 5 keys (empty string when unused) so stale text from a previous
 * longer conversation gets cleared on update.
 */
// MDA's SMAX pages, grouped by the platform prefix their customer pids carry.
// Used to GUESS the page when a customer-endpoint touchpoint has no page_pid:
// we try each candidate page; the wrong one just 404s (harmless).
const PAGE_CANDIDATES_BY_PREFIX: Array<{ prefix: string; pages: string[] }> = [
  { prefix: "zlw", pages: ["zlw543187459113764384"] },
  { prefix: "zl",  pages: ["zl2235256473219383054"] },
  { prefix: "fb",  pages: ["fb102323788540150", "fb107203051058856"] },
  { prefix: "ig",  pages: ["ig17841446528067260", "ig17841460097450702"] },
  { prefix: "ctm", pages: ["ctm68188e11779d16c0779c018c"] },
];

function guessPagesForPid(pid: string): string[] {
  // Order matters: "zlw" must match before "zl"
  for (const { prefix, pages } of PAGE_CANDIDATES_BY_PREFIX) {
    if (pid.startsWith(prefix)) return pages;
  }
  return [];
}

/**
 * Resolve every (page_pid, tid) chat thread for a set of leads.
 * Thread touchpoints carry payload.tid directly; customer-endpoint touchpoints
 * don't, but on SMAX the thread tid equals the customer's platform pid
 * (verified: thread_tid == customer.pid for Zalo/FB), so we fall back to
 * (page_pid|guessed pages, external_profile_id).
 */
export async function getThreadsForLeads(
  admin: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          in: (c: string, v: string[]) => PromiseLike<{ data: Array<Record<string, unknown>> | null }>;
        };
      };
    };
  },
  leadIds: string[],
  pidByLead: Map<string, string | null>
): Promise<Map<string, Array<{ pagePid: string; tid: string }>>> {
  const result = new Map<string, Array<{ pagePid: string; tid: string }>>();
  const seenLeads = new Set<string>();
  for (let i = 0; i < leadIds.length; i += 100) {
    const batch = leadIds.slice(i, i + 100);
    const { data } = await admin
      .from("fact_touchpoint")
      .select("lead_id, tid:payload->>tid, page_pid:payload->>page_pid")
      .eq("source", "smax")
      .in("lead_id", batch);
    for (const r of data ?? []) {
      const leadId = r.lead_id as string;
      if (!leadId) continue;
      seenLeads.add(leadId);
      const tid = (r.tid as string | null) || null;
      const pagePid = (r.page_pid as string | null) || null;
      let arr = result.get(leadId);
      if (!arr) { arr = []; result.set(leadId, arr); }
      if (tid && pagePid && !arr.some((t) => t.tid === tid)) {
        arr.push({ pagePid, tid });
      } else if (!tid) {
        // customer-endpoint row: thread tid == the customer's platform pid.
        // Use the row's page_pid when present, else guess from pid prefix.
        const pid = pidByLead.get(leadId);
        if (!pid || arr.some((t) => t.tid === pid)) continue;
        const pages = pagePid ? [pagePid] : guessPagesForPid(pid);
        for (const p of pages) arr.push({ pagePid: p, tid: pid });
      }
    }
  }
  // Leads with no usable touchpoint info at all: last-ditch guess from pid.
  for (const leadId of leadIds) {
    if (result.get(leadId)?.length) continue;
    const pid = pidByLead.get(leadId);
    if (!pid) continue;
    const pages = guessPagesForPid(pid);
    if (pages.length) result.set(leadId, pages.map((p) => ({ pagePid: p, tid: pid })));
  }
  return result;
}

export async function buildChatHistoryFields(
  threads: Array<{ pagePid: string; tid: string }>
): Promise<Record<string, string>> {
  const all: Array<{ ts: string; staff: boolean; text: string }> = [];
  for (const t of threads) {
    if (!t.pagePid || !t.tid) continue;
    const msgs = await fetchThreadMessages(t.pagePid, t.tid);
    all.push(...msgs);
  }
  // chronological (oldest → newest)
  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const lines = all.map(fmtLine);
  const budget = CHAT_COL_COUNT * CHAT_COL_CHAR_LIMIT;

  // Keep NEWEST lines within total budget (drop oldest, note the cut)
  let kept = lines;
  let totalLen = lines.reduce((s, l) => s + l.length + 1, 0);
  if (totalLen > budget) {
    kept = [];
    let acc = "(…đã lược bớt tin nhắn cũ…)\n".length;
    for (let i = lines.length - 1; i >= 0; i--) {
      const cost = lines[i].length + 1;
      if (acc + cost > budget) break;
      acc += cost;
      kept.unshift(lines[i]);
    }
    kept.unshift("(…đã lược bớt tin nhắn cũ…)");
  }

  const full = kept.join("\n");
  const fields: Record<string, string> = {};
  for (let i = 0; i < CHAT_COL_COUNT; i++) {
    fields[CHAT_COL_NAMES[i]] = full.slice(i * CHAT_COL_CHAR_LIMIT, (i + 1) * CHAT_COL_CHAR_LIMIT);
  }
  return fields;
}
