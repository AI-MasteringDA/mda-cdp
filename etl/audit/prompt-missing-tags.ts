/**
 * Prompt for Case B — "Missing Tags" audit
 *
 * Input: chat log + current SMAX tags
 * Output: list of tags that SHOULD be on the lead but aren't
 *
 * Design choices:
 * - Only suggest tags from an EXPLICIT allowed list (no hallucinated tags)
 * - Require quoted evidence from chat for every suggestion
 * - Return empty list if not confident — false positives kill trust
 */

/**
 * Load the tag whitelist DYNAMICALLY from Supabase — union of every distinct
 * value ever seen in dim_lead.smax_tags. That's every tag Giàu (or any TVV)
 * has ever gattached to any lead. When they open a new class (K64, K65…) it
 * shows up automatically after the next SMAX ETL run — no code change needed.
 *
 * Called once per audit run and cached for that run.
 */
export async function loadAllowedSmaxTags(
  admin: { from: (t: string) => { select: (c: string) => Promise<{ data: Array<{ smax_tags: string[] | null }> | null }> } }
): Promise<Set<string>> {
  const { data } = await admin.from("dim_lead").select("smax_tags");
  const set = new Set<string>();
  for (const row of data ?? []) {
    for (const t of row.smax_tags ?? []) {
      if (typeof t === "string" && t.trim()) set.add(t.trim());
    }
  }
  return set;
}

export const SYSTEM_PROMPT = `Bạn là một audit AI cho hệ thống CRM SMAX của công ty Mastering Data Analytics (MDA).

Vai trò của bạn: đọc lịch sử chat giữa customer và tư vấn viên (TVV) → xác định các tag mà customer NÊN được gắn dựa vào nội dung chat, nhưng CHƯA được TVV gắn.

QUY TẮC BẮT BUỘC:
1. CHỈ được suggest tag từ danh sách hợp lệ (được cung cấp trong prompt user).
   TUYỆT ĐỐI không tự chế tên tag mới. Nếu chat rõ ràng cần 1 khái niệm chưa có trong list → bỏ qua.

2. Mỗi tag suggest PHẢI có bằng chứng RÕ RÀNG trong chat.
   Ví dụ đúng: chat có "em muốn đăng ký K61 nha" → suggest "K61" ✓
   Ví dụ sai: chat có "em muốn học lớp mới" → KHÔNG được suggest "K61" (không cụ thể)

3. Nếu không CHẮC CHẮN → trả về [] (empty).
   Sai còn tệ hơn bỏ sót. Sales sẽ mất trust nếu bạn báo sai.

4. Không suggest tag đã có trong "Tag hiện có".

5. Trả về JSON chuẩn, KHÔNG kèm markdown/giải thích thừa:
{
  "missing_tags": ["tag1", "tag2"],
  "evidence": [
    {"tag": "tag1", "quote": "đoạn chat nguyên văn", "reason": "vì sao tag này"}
  ],
  "note": "1-2 câu ngắn tóm tắt cho TVV thấy"
}

Nếu không thiếu tag nào: {"missing_tags": [], "evidence": [], "note": "OK"}`;

export type SmaxMessage = {
  sender_is_staff: boolean;
  content: string;
  occurred_at: string;
};

export function buildUserPrompt(input: {
  leadName: string;
  currentTags: string[];
  messages: SmaxMessage[];
  allowedTags: Set<string>;
}): string {
  const tagList = Array.from(input.allowedTags).sort().join(", ");
  const currentTagsStr = input.currentTags.length ? input.currentTags.join(", ") : "(chưa có tag nào)";
  const chatLog = input.messages
    .slice()
    .reverse() // oldest first for chronological reading
    .map((m) => {
      const who = m.sender_is_staff ? "TVV" : "Khách";
      const time = m.occurred_at.slice(11, 16);
      const text = m.content?.trim() || "(không có nội dung)";
      return `[${time}] ${who}: ${text}`;
    })
    .join("\n");

  return `Danh sách tag hợp lệ (chỉ được chọn từ đây):
${tagList}

Tag khách "${input.leadName}" hiện có: ${currentTagsStr}

Lịch sử chat (chronological, oldest first):
${chatLog}

Task: Trả về JSON theo format trong system prompt.`;
}

export type AuditResult = {
  missing_tags: string[];
  evidence: Array<{ tag: string; quote: string; reason: string }>;
  note: string;
};

export function validateAuditResult(raw: unknown, allowedTags: Set<string>): AuditResult {
  if (!raw || typeof raw !== "object") throw new Error("AI trả về không phải object");
  const r = raw as Record<string, unknown>;
  const missing = Array.isArray(r.missing_tags) ? (r.missing_tags as string[]) : [];
  const evidence = Array.isArray(r.evidence) ? (r.evidence as AuditResult["evidence"]) : [];
  const note = typeof r.note === "string" ? r.note : "";

  // Guard: strip any hallucinated tags not in whitelist
  const cleanMissing = missing.filter((t) => allowedTags.has(t));
  const cleanEvidence = evidence.filter((e) => allowedTags.has(e.tag));
  const dropped = missing.length - cleanMissing.length;
  if (dropped > 0) console.warn(`[audit] dropped ${dropped} hallucinated tag(s): ${missing.filter(t => !allowedTags.has(t)).join(", ")}`);

  return { missing_tags: cleanMissing, evidence: cleanEvidence, note };
}
