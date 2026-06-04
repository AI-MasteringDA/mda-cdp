import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY chưa được set. Add vào Vercel → Settings → Environment Variables → Production/Preview/Development → Redeploy."
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

// Sonnet for deep analysis. Haiku for quick mode.
export const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const FALLBACK_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-3-5-sonnet-latest",
];

export type LeadInsight = {
  summary: string;
  engagement_metrics: {
    emails_sent_by_mda: number;
    emails_opened: number;
    open_rate_pct: number;
    emails_clicked: number;
    chats_from_lead: number;
    chats_from_tvv: number;
    attachments_from_lead: number;
    attachments_from_tvv: number;
    calls_logged: number;
    days_since_first_touch: number | null;
    days_since_last_lead_action: number | null;
    days_since_last_mda_action: number | null;
  };
  key_moments: Array<{
    date: string;
    event: string;
    significance: string;
  }>;
  lead_voice: {
    topics_interested: string[];
    concerns_raised: string[];
    buying_signals: string[];
  };
  mda_nurture: {
    channels_used: string[];
    recent_campaigns: string[];
    responsiveness: "fast" | "moderate" | "slow" | "ignored";
    quality_assessment: string;
  };
  intent_score: "high" | "medium" | "low" | "unclear";
  intent_reasoning: string;
  risk_signals: string[];
  opportunity: string;
  action: "GỌI NGAY" | "EMAIL CÁ NHÂN HÓA" | "GỬI VOUCHER" | "FOLLOW-UP NHẸ" | "ARCHIVE";
  action_reason: string;
  talking_points: Array<{
    hook: string;
    followup: string;
  }>;
};

const SYSTEM_PROMPT = `Bạn là Senior Sales Analyst cho MDA Platform — CDP của Mastering Data Analytics (công ty đào tạo BI/Data/AI tại Việt Nam).

KHÁCH HÀNG MDA: Người muốn học các khóa BI (Power BI/Tableau), FA (Financial Analytics), AGENTIC AI ANALYTICS, Excel nâng cao, Python/SQL — chủ yếu là analyst, kế toán, kỹ sư, nhân viên văn phòng đang upskill.

CONTEXT: TVV (telesales/tư vấn viên) chuẩn bị liên hệ lead này. Bạn nhận hồ sơ 360° từ Salesforce + SMAX chat + Instantly email + Wix Web. **Phân tích sâu, dựa bằng chứng cụ thể**, không nói chung chung.

NHIỆM VỤ: Trả về 1 JSON object (không có markdown wrap, không text khác) đúng schema dưới đây. Phân tích phải:
1. **Trích dẫn timeline cụ thể** — ngày, nội dung, ai gửi (LEAD vs TVV)
2. **Nhận diện pattern** — lead chủ đề gì, hesitation gì, tăng/giảm engagement theo thời gian
3. **Đánh giá nỗ lực MDA** — TVV đã chăm tốt chưa, có gap follow-up không
4. **Quote tin nhắn thật** trong talking_points — không bịa, không generic

SCHEMA:
{
  "summary": "2-3 câu mô tả tổng quan — TÌNH TRẠNG hiện tại + nguyên nhân điểm cao/thấp + bottleneck chính (60-80 từ)",

  "engagement_metrics": {
    "emails_sent_by_mda": number (đếm email_sent),
    "emails_opened": number (đếm email_open),
    "open_rate_pct": number (open / sent * 100, làm tròn 1 chữ số),
    "emails_clicked": number,
    "chats_from_lead": number (đếm event 'chat' do LEAD gửi - check sender khi có),
    "chats_from_tvv": number (đếm event 'chat_staff'),
    "attachments_from_lead": number,
    "attachments_from_tvv": number,
    "calls_logged": number,
    "days_since_first_touch": number | null,
    "days_since_last_lead_action": number | null (LEAD chat/click/open mới nhất, null nếu chưa từng),
    "days_since_last_mda_action": number | null (TVV chat/email mới nhất)
  },

  "key_moments": [
    {
      "date": "YYYY-MM-DD",
      "event": "Mô tả ngắn (1 câu)",
      "significance": "Ý nghĩa với sales (1 câu)"
    }
    // 3-6 sự kiện quan trọng nhất theo thứ tự thời gian, ưu tiên: lead chủ động + conversion + drop engagement
  ],

  "lead_voice": {
    "topics_interested": ["chủ đề lead quan tâm — bắt từ title/detail tin nhắn của LEAD"],
    "concerns_raised": ["concern/hesitation/câu hỏi LEAD đặt ra"],
    "buying_signals": ["dấu hiệu mua hàng cụ thể: hỏi giá, hỏi lịch khai giảng, xin email/SĐT tư vấn, etc."]
  },

  "mda_nurture": {
    "channels_used": ["smax","instantly","salesforce", ...],
    "recent_campaigns": ["subject email gần đây + title TVV chat broadcast — 3-5 cái"],
    "responsiveness": "fast" (TVV reply trong vài giờ) | "moderate" (1-2 ngày) | "slow" (>3 ngày) | "ignored" (lead chat nhưng TVV chưa rep),
    "quality_assessment": "1-2 câu đánh giá honest: TVV chăm tốt chưa, có miss cơ hội không"
  },

  "intent_score": "high" | "medium" | "low" | "unclear",
  "intent_reasoning": "1-2 câu giải thích vì sao chọn level đó — dựa trên buying signals + recency",

  "risk_signals": [
    "Rủi ro 1 (vd: 'Lead đã im lặng 14 ngày sau khi hỏi giá')",
    "..."
    // Liệt kê rủi ro thật, max 3
  ],

  "opportunity": "1-2 câu — góc tiếp cận lớn nhất hiện tại để chốt deal",

  "action": "GỌI NGAY" | "EMAIL CÁ NHÂN HÓA" | "GỬI VOUCHER" | "FOLLOW-UP NHẸ" | "ARCHIVE",
  "action_reason": "1 câu giải thích vì sao action này phù hợp NOW (≤30 từ)",

  "talking_points": [
    {
      "hook": "Câu mở đầu cụ thể — REFERENCE tin nhắn/email thật của lead (vd: 'Em thấy chị đã hỏi về lịch khai giảng FA K58 ngày 2/6, hiện vẫn còn voucher 5% cho 6 ngày nữa...')",
      "followup": "Câu chuyển tiếp tự nhiên dẫn tới close (vd: 'Em xin 10p call để demo dashboard FA chị muốn build')"
    }
    // 3 cặp hook+followup, mỗi cái dựa trên 1 fact thật từ timeline
  ]
}

NGUYÊN TẮC:
- **Tiếng Việt tự nhiên, sales-y** — không hành chính cứng
- **KHÔNG BỊA** — chỉ nói điều có trong timeline. Nếu thiếu data, ghi rõ "chưa rõ"
- **Specific > Generic** — "Lead hỏi về AGENTIC AI K60 ngày 2/6" tốt hơn "Lead quan tâm AI"
- **Action ưu tiên theo tier**:
  * NÓNG (70-100) + lead vừa chat → GỌI NGAY
  * NÓNG nhưng lead silent → EMAIL CÁ NHÂN HÓA
  * NÓNG + buying signal mạnh → GỬI VOUCHER + GỌI NGAY
  * ẤM → EMAIL CÁ NHÂN HÓA
  * MÁT → FOLLOW-UP NHẸ
  * NGỦ ĐÔNG → ARCHIVE (trừ khi có signal mới)

QUY TẮC OUTPUT (NGHIÊM NGẶT):
- Output PHẢI bắt đầu bằng ký tự '{' và kết thúc bằng '}'.
- KHÔNG có \`\`\`json hoặc text trước/sau JSON.
- KHÔNG có giải thích, KHÔNG có markdown.
- Tất cả strings phải được escape đúng JSON (\\n, \\", \\\\).
- Token budget có hạn — viết SÚC TÍCH, không lặp ý, prioritize quality > quantity.

CHỈ TRẢ VỀ 1 JSON object hợp lệ.`;

export type LeadContext = {
  name: string;
  email: string;
  phone: string;
  stage: string;
  score: number;
  tier: string;
  reasons: { sign: string; label: string; points: number }[];
  company: string | null;
  leadSource: string | null;
  source: string;
  // Pre-computed exact metrics — feed to model so it doesn't have to count
  precomputed: {
    total_touchpoints: number;
    emails_sent_by_mda: number;
    emails_opened: number;
    emails_clicked: number;
    emails_replied: number;
    chats_from_lead: number;
    chats_from_tvv: number;
    attachments_from_lead: number;
    attachments_from_tvv: number;
    attachments_unknown: number;
    calls_logged: number;
    days_since_first_touch: number | null;
    days_since_last_lead_action: number | null;
    days_since_last_mda_action: number | null;
  };
  timeline: Array<{
    date: string;
    source: string;
    type: string;
    sender: "LEAD" | "TVV" | "MDA" | "—";
    title: string;
    detail?: string;
  }>;
};

function formatLeadContext(ctx: LeadContext): string {
  const m = ctx.precomputed;
  const openRate = m.emails_sent_by_mda > 0
    ? ((m.emails_opened / m.emails_sent_by_mda) * 100).toFixed(1)
    : "0";
  const lines: string[] = [
    `=== HỒ SƠ LEAD ===`,
    `Tên:       ${ctx.name}`,
    `Email:     ${ctx.email || "—"}`,
    `Phone:     ${ctx.phone || "—"}`,
    `Công ty:   ${ctx.company || "—"}`,
    `Stage SF:  ${ctx.stage}`,
    `Score:     ${ctx.score}/100 (${ctx.tier})`,
    `Nguồn:     ${ctx.source}${ctx.leadSource ? ` (${ctx.leadSource})` : ""}`,
    ``,
    `=== CẤU THÀNH ĐIỂM ===`,
    ...ctx.reasons.map((r) => `  ${r.sign}${r.points} ${r.label}`),
    ``,
    `=== METRICS (đã đếm sẵn từ DB) ===`,
    `Tổng touchpoints:            ${m.total_touchpoints}`,
    `MDA email gửi:               ${m.emails_sent_by_mda}`,
    `Lead mở email:               ${m.emails_opened}  (open rate ${openRate}%)`,
    `Lead click email:            ${m.emails_clicked}`,
    `Lead reply email:            ${m.emails_replied}`,
    `LEAD chat (text):            ${m.chats_from_lead}`,
    `TVV chat (text):             ${m.chats_from_tvv}`,
    `LEAD gửi file:               ${m.attachments_from_lead}`,
    `TVV gửi file:                ${m.attachments_from_tvv}`,
    `File không rõ ai gửi:        ${m.attachments_unknown}`,
    `Calls:                       ${m.calls_logged}`,
    `Ngày kể từ touch đầu:        ${m.days_since_first_touch ?? "—"}`,
    `Ngày kể từ LEAD action cuối: ${m.days_since_last_lead_action ?? "—"}`,
    `Ngày kể từ MDA action cuối:  ${m.days_since_last_mda_action ?? "—"}`,
    ``,
    `=== TIMELINE (${ctx.timeline.length} events, mới → cũ) ===`,
    ...ctx.timeline.slice(0, 40).map((t) => {
      const senderTag = t.sender === "—" ? "" : ` [${t.sender}]`;
      return `  [${t.date}] (${t.source}/${t.type})${senderTag} ${t.title}${
        t.detail ? `\n      DETAIL: ${t.detail.slice(0, 200)}` : ""
      }`;
    }),
  ];
  if (ctx.timeline.length > 40) {
    lines.push(`  ...và ${ctx.timeline.length - 40} events cũ hơn không hiển thị`);
  }
  return lines.join("\n");
}

async function tryModels(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  const tried: string[] = [];
  for (const model of FALLBACK_MODELS) {
    try {
      return await getClient().messages.create({ ...params, model });
    } catch (e) {
      const err = e as Error & { status?: number };
      tried.push(`${model}: ${err.message.slice(0, 80)}`);
      if (err.status !== 404) throw e;
    }
  }
  throw new Error(`All models failed:\n${tried.join("\n")}`);
}

export async function generateLeadInsight(ctx: LeadContext): Promise<LeadInsight> {
  const message = await tryModels({
    model: AI_MODEL,
    max_tokens: 8000,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: formatLeadContext(ctx) + "\n\nTrả về JSON object đúng schema, bắt đầu bằng '{' và kết thúc bằng '}'. KHÔNG có text khác.",
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Extract JSON: find first '{' and last '}' if model adds extra text
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  let raw = firstBrace >= 0 && lastBrace > firstBrace
    ? text.slice(firstBrace, lastBrace + 1)
    : text;
  // Strip any markdown wrap fragments
  raw = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  // Try direct parse first
  try {
    return JSON.parse(raw) as LeadInsight;
  } catch {
    // Recovery: truncated by max_tokens? Repair structure.
    // If no last '}' found, work with everything from first '{'
    const toRepair = firstBrace >= 0 ? text.slice(firstBrace) : text;
    const repaired = repairTruncatedJson(toRepair);
    try {
      return JSON.parse(repaired) as LeadInsight;
    } catch (e2) {
      throw new Error(
        `Failed to parse AI response (stop_reason=${message.stop_reason}): ${(e2 as Error).message}\nRaw start: ${text.slice(0, 250)}\nRaw end: ${text.slice(-250)}`
      );
    }
  }
}

/**
 * Best-effort repair for JSON truncated by max_tokens.
 * Walks the string tracking string/array/object nesting and closes them.
 */
function repairTruncatedJson(s: string): string {
  let out = s;
  let inString = false;
  let escaped = false;
  const stack: string[] = []; // tracks open '{' and '['
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }

  // If we ended inside a string, close it
  if (inString) out += '"';
  // Trim trailing comma if present at the tail (illegal JSON)
  out = out.replace(/,\s*$/, "");
  // Close brackets in reverse order
  while (stack.length > 0) {
    const open = stack.pop();
    out += open === "{" ? "}" : "]";
  }
  return out;
}
