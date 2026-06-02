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

export const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

const FALLBACK_MODELS = [
  "claude-haiku-4-5",
  "claude-3-5-haiku-latest",
  "claude-3-5-haiku-20241022",
];

export type LeadInsight = {
  summary: string;
  insights: string[];
  action: "GỌI NGAY" | "EMAIL CÁ NHÂN HÓA" | "GỬI VOUCHER" | "FOLLOW-UP NHẸ" | "ARCHIVE";
  action_reason: string;
  talking_points: string[];
};

const SYSTEM_PROMPT = `Bạn là AI assistant cho MDA Platform — CDP cho công ty đào tạo Data Analytics MDA (Mastering Data Analytics).
Khách hàng MDA là người muốn học các khóa: BI (Power BI/Tableau), FA (Financial Analytics), AGENTIC AI ANALYTICS, Excel nâng cao, Python/SQL.

TVV (telesales/tư vấn viên) đang chuẩn bị liên hệ lead. Bạn nhận hồ sơ lead 360° gồm metadata + timeline events từ nhiều nguồn (Salesforce/SMAX chat/Instantly email/Wix Web).

NHIỆM VỤ: Trả về 1 JSON object (không có markdown wrap, không có text khác) với schema:

{
  "summary": "1 câu mô tả tình trạng lead (15-25 từ)",
  "insights": ["Insight 1 (≤20 từ)", "Insight 2", "Insight 3"],
  "action": "GỌI NGAY" | "EMAIL CÁ NHÂN HÓA" | "GỬI VOUCHER" | "FOLLOW-UP NHẸ" | "ARCHIVE",
  "action_reason": "1 câu giải thích vì sao chọn action đó (≤25 từ)",
  "talking_points": ["Điểm 1 để mở đầu cuộc gọi/email (≤20 từ)", "Điểm 2", "Điểm 3"]
}

QUY TẮC:
- Tiếng Việt, ngắn gọn, action-oriented
- Insights phải DỰA TRÊN TIMELINE THẬT — phát hiện pattern (course quan tâm? đa kênh? recency? burnout vì spam email?)
- Talking points = câu cụ thể TVV nói khi gọi, dựa trên event thật (ví dụ "Em thấy anh đã chat về AGENTIC AI ANALYTICS ngày 2/6...")
- KHÔNG BỊA thông tin không có trong hồ sơ
- Action ưu tiên theo tier:
  * NÓNG → GỌI NGAY hoặc GỬI VOUCHER
  * ẤM → EMAIL CÁ NHÂN HÓA hoặc GỌI NGAY
  * MÁT → FOLLOW-UP NHẸ
  * NGỦ ĐÔNG → ARCHIVE
- Nếu lead đã chat gần đây nhưng TVV chưa reply → GỌI NGAY
- Nếu lead chỉ nhận email không tương tác → FOLLOW-UP NHẸ
- Nếu lead có conversion event → GỬI VOUCHER cho khóa khác (upsell)

TRẢ VỀ CHỈ JSON, KHÔNG có \`\`\`json hoặc text trước/sau.`;

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
  timeline: Array<{
    date: string;
    source: string;
    type: string;
    title: string;
    detail?: string;
  }>;
};

function formatLeadContext(ctx: LeadContext): string {
  const lines: string[] = [
    `Lead: ${ctx.name}`,
    `Email: ${ctx.email || "—"}`,
    `Phone: ${ctx.phone || "—"}`,
    `Company: ${ctx.company || "—"}`,
    `Stage: ${ctx.stage}`,
    `Score: ${ctx.score}/100 (Tier: ${ctx.tier})`,
    `Source: ${ctx.source}${ctx.leadSource ? ` (${ctx.leadSource})` : ""}`,
    `Reasons (cấu thành điểm):`,
    ...ctx.reasons.map((r) => `  ${r.sign}${r.points} ${r.label}`),
    "",
    `Timeline (${ctx.timeline.length} events, mới → cũ):`,
    ...ctx.timeline.slice(0, 30).map(
      (t) => `  [${t.date}] (${t.source}/${t.type}) ${t.title}${t.detail ? ` — ${t.detail}` : ""}`
    ),
  ];
  if (ctx.timeline.length > 30) {
    lines.push(`  ...và ${ctx.timeline.length - 30} events cũ hơn`);
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
      if (err.status !== 404) throw e; // re-throw non-404 errors immediately
    }
  }
  throw new Error(`All Haiku models failed:\n${tried.join("\n")}`);
}

export async function generateLeadInsight(ctx: LeadContext): Promise<LeadInsight> {
  const message = await tryModels({
    model: AI_MODEL,
    max_tokens: 800,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }, // prompt cache for cost
      },
    ],
    messages: [
      {
        role: "user",
        content: formatLeadContext(ctx),
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Strip potential ```json wrapping in case model adds it
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as LeadInsight;
    return parsed;
  } catch (e) {
    throw new Error(
      `Failed to parse AI response as JSON: ${(e as Error).message}\nRaw: ${cleaned.slice(0, 200)}`
    );
  }
}
