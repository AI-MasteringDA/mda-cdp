import Anthropic from "@anthropic-ai/sdk";
import {
  ENROLLED_STUDENT,
  LEAD,
  CONSULTED,
  CONVERSION_RATE,
  CAC,
  LTV,
  ATTRIBUTION_RULE,
  SOURCE_CHANNELS,
} from "@/lib/metrics-config";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY chưa được set.");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

export const GROWTH_AI_MODEL = process.env.ANTHROPIC_GROWTH_MODEL || "claude-sonnet-4-6";

const FALLBACK_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
];

export type GrowthPlan = {
  /** 2-3 câu tổng quan tình trạng tăng trưởng */
  executive_summary: string;
  /** Tier hệ thống đang vận hành: "stable" | "growing" | "declining" | "uncertain" */
  health_status: "healthy" | "growing" | "concerning" | "critical";
  health_reasoning: string;

  /** Phát hiện về Attribution */
  attribution_findings: Array<{
    insight: string;
    evidence: string;
    business_impact: string;
  }>;

  /** Phát hiện về Funnel */
  funnel_findings: Array<{
    insight: string;
    evidence: string;
    business_impact: string;
  }>;

  /** Phát hiện về Segments */
  segment_findings: Array<{
    insight: string;
    evidence: string;
    business_impact: string;
  }>;

  /** Growth hypotheses — giả thuyết tăng trưởng để TEST */
  hypotheses: Array<{
    hypothesis: string; // "If we X, then Y because Z"
    rationale: string;  // tại sao tin hypothesis này
    test_plan: string;  // làm sao test (cohort, duration, success metric)
    expected_impact: "high" | "medium" | "low";
    confidence: "high" | "medium" | "low";
  }>;

  /** Action items sắp xếp theo priority */
  action_items: Array<{
    priority: "P0" | "P1" | "P2";
    action: string;
    owner: string; // "Marketing" | "Sales/TVV" | "Data" | "Leadership"
    timeline: string; // "Tuần này" | "30 ngày" | etc.
    expected_outcome: string;
  }>;

  /** Risks và blockers */
  risks: string[];

  /** Recommendations về data infra MDA cần fix để insights chính xác hơn */
  data_infrastructure_gaps: string[];
};

const SYSTEM_PROMPT = `Bạn là Senior Growth Analyst cho Mastering Data Analytics (MDA) — công ty đào tạo BI/Data/AI tại Việt Nam.

VAI TRÒ: Bạn nhận snapshot toàn bộ growth data của MDA → phân tích sâu → đề xuất KẾ HOẠCH TĂNG TRƯỞNG dạng giả thuyết để test, KHÔNG phải hành động auto.

NGUYÊN TẮC (NGHIÊM NGẶT):
1. **NEO VÀO SỐ THẬT** — mỗi finding/hypothesis phải dẫn về số liệu cụ thể trong context. KHÔNG bịa, KHÔNG nói chung chung.
2. **TRÍCH DẪN ROW** — khi nói về source/segment, ghi rõ "Source X có Y leads / Z chốt = W%". User phải verify được.
3. **HYPOTHESIS, KHÔNG PHẢI FACT** — kế hoạch growth là *giả thuyết để bàn*, viết theo format "If ... then ... because ...".
4. **PHÂN BIỆT CONFIDENCE LEVELS** — high confidence (data clear) vs low (data limited).
5. **THỪA NHẬN LIMITATIONS** — nếu thiếu data (CAC, revenue, multi-touch attribution), nêu ra trong \`data_infrastructure_gaps\`.
6. **AI ĐỀ XUẤT, NGƯỜI QUYẾT** — không claim "chắc chắn nên làm X". Format: "Test hypothesis X bằng ABC, success = Y".

ĐỊNH NGHĨA QUAN TRỌNG (canonical):
- **1 học viên** = lead có conversion_count > 0 (caveat: chưa phân biệt đăng ký vs đã đóng tiền — heuristic v1)
- **Attribution rule hiện tại**: first-touch via dim_lead.source
- **CAC**: CHƯA TÍNH ĐƯỢC (thiếu spend data) — phải nêu nếu user hỏi về CAC
- **LTV**: CHƯA TÍNH ĐƯỢC (thiếu revenue data)

OUTPUT (NGHIÊM NGẶT):
- JSON object đúng schema dưới đây
- KHÔNG có markdown wrap (\`\`\`json), KHÔNG có text trước/sau
- Tất cả strings escape đúng JSON
- Bắt đầu bằng '{' kết thúc bằng '}'

SCHEMA:
{
  "executive_summary": "2-3 câu tóm tắt tình trạng growth hiện tại + bottleneck chính + cơ hội lớn nhất (80-100 từ)",

  "health_status": "healthy" | "growing" | "concerning" | "critical",
  "health_reasoning": "1-2 câu giải thích status đó dựa trên metrics",

  "attribution_findings": [
    {
      "insight": "1 câu finding cụ thể (vd: 'SMAX Brand chốt 8.4% vs SMAX KOL 2.1% — chênh 4x')",
      "evidence": "Số cụ thể từ context (vd: 'SMAX Brand: 21/250 leads chốt; KOL: 4/190 chốt')",
      "business_impact": "Nghĩa cho business (vd: 'Đầu tư Brand fanpage tạo ra học viên thật, KOL fanpage chỉ tạo lead noise')"
    }
    // 2-4 findings
  ],

  "funnel_findings": [/* same shape */],

  "segment_findings": [/* same shape — về phân khúc giá trị cao */],

  "hypotheses": [
    {
      "hypothesis": "If [action] then [outcome] because [reasoning]",
      "rationale": "Tại sao tin hypothesis này dựa trên data — quote số",
      "test_plan": "Cách test: cohort size, duration, success metric, control",
      "expected_impact": "high" | "medium" | "low",
      "confidence": "high" | "medium" | "low"
    }
    // 3-5 hypotheses, ưu tiên impact + feasibility
  ],

  "action_items": [
    {
      "priority": "P0" | "P1" | "P2",
      "action": "Hành động cụ thể (vd: 'Tăng 30% spend vào FB Brand fanpage trong 4 tuần')",
      "owner": "Marketing" | "Sales/TVV" | "Data" | "Leadership",
      "timeline": "Tuần này" | "2-4 tuần" | "1 tháng" | "Quý sau",
      "expected_outcome": "Kết quả dự kiến + cách đo"
    }
    // 3-6 actions, sắp xếp theo priority
  ],

  "risks": ["Rủi ro 1", "Rủi ro 2", "..."],

  "data_infrastructure_gaps": [
    "Gap 1 mà MDA nên fix để insights chính xác hơn (vd: 'Ingest ad spend data từ Google/FB/TikTok Ads để tính CAC')",
    "..."
  ]
}

TRẢ VỀ CHỈ JSON object hợp lệ.`;

export type GrowthContext = {
  // Macro counts
  total_leads: number;
  total_students: number; // enrolled (conversion_count > 0)
  overall_conversion_rate_pct: number;

  // Tier distribution
  tier_distribution: { name: string; count: number }[];

  // Funnel
  funnel: { stage: string; count: number; drop_pct_from_prev: number | null }[];

  // Source breakdown (with conversion)
  source_breakdown: Array<{
    source: string;
    leads: number;
    students: number;
    conversion_rate_pct: number;
    touchpoints: number;
  }>;

  // SMAX sub-channels
  smax_channels: Array<{
    page_pid: string;
    label: string;
    touchpoints: number;
  }>;

  // Stage distribution from Salesforce
  stage_distribution: { stage: string; count: number }[];

  // Cohort engagement/conversion rates last 12 months
  cohorts: Array<{
    month: string;
    total: number;
    engaged: number;
    converted: number;
    engagement_rate_pct: number;
    conversion_rate_pct: number;
  }>;

  // Engagement buckets
  engagement_buckets: { label: string; count: number }[];

  // TVV performance
  tvv_top: Array<{ name: string; lead_count: number; converted: number; conversion_rate_pct: number }>;

  // Time-relevant counts
  hot_leads_count: number;
  stale_leads_30d: number;

  // Recent activity
  recent_period_days: number;
  recent_conversions: number;
  recent_new_leads: number;
};

function formatGrowthContext(ctx: GrowthContext): string {
  const lines: string[] = [
    `=== MDA GROWTH SNAPSHOT (now) ===`,
    `Tổng lead:                ${ctx.total_leads.toLocaleString("vi-VN")}`,
    `Tổng học viên (chốt):     ${ctx.total_students.toLocaleString("vi-VN")}`,
    `Conversion rate tổng:     ${ctx.overall_conversion_rate_pct.toFixed(2)}%`,
    `Lead NÓNG đang chờ:       ${ctx.hot_leads_count.toLocaleString("vi-VN")}`,
    `Lead nguội >30 ngày:      ${ctx.stale_leads_30d.toLocaleString("vi-VN")}`,
    ``,
    `=== TIER DISTRIBUTION ===`,
    ...ctx.tier_distribution.map((t) => `  ${t.name.padEnd(10)}: ${t.count.toLocaleString("vi-VN")}`),
    ``,
    `=== FUNNEL ===`,
    ...ctx.funnel.map(
      (f) =>
        `  ${f.stage.padEnd(28)} ${f.count.toLocaleString("vi-VN").padStart(8)}` +
        (f.drop_pct_from_prev !== null ? `   (drop ${f.drop_pct_from_prev.toFixed(1)}% từ trên)` : "")
    ),
    ``,
    `=== STAGE DISTRIBUTION (SF) ===`,
    ...ctx.stage_distribution.map((s) => `  ${s.stage.padEnd(20)}: ${s.count.toLocaleString("vi-VN")}`),
    ``,
    `=== SOURCE BREAKDOWN (attribution first-touch) ===`,
    `  source            leads      students   conv%   touchpoints`,
    ...ctx.source_breakdown.map(
      (s) =>
        `  ${s.source.padEnd(16)} ${s.leads.toLocaleString("vi-VN").padStart(8)}   ` +
        `${s.students.toLocaleString("vi-VN").padStart(8)}  ${s.conversion_rate_pct.toFixed(2)}%   ` +
        `${s.touchpoints.toLocaleString("vi-VN")}`
    ),
    ``,
    `=== SMAX SUB-CHANNELS (theo page_pid) ===`,
    ...ctx.smax_channels.map(
      (c) => `  ${c.label.padEnd(28)}: ${c.touchpoints.toLocaleString("vi-VN")} touchpoints`
    ),
    ``,
    `=== COHORTS 12 THÁNG GẦN NHẤT ===`,
    `  month     total   engaged  eng%    conv   conv%`,
    ...ctx.cohorts.map(
      (c) =>
        `  ${c.month}   ${c.total.toString().padStart(6)} ${c.engaged.toString().padStart(8)}` +
        ` ${c.engagement_rate_pct.toFixed(1)}%   ${c.converted.toString().padStart(5)}  ${c.conversion_rate_pct.toFixed(2)}%`
    ),
    ``,
    `=== ENGAGEMENT BUCKETS ===`,
    ...ctx.engagement_buckets.map((b) => `  ${b.label.padEnd(28)}: ${b.count.toLocaleString("vi-VN")}`),
    ``,
    `=== TOP TVV PERFORMANCE ===`,
    ...ctx.tvv_top
      .slice(0, 10)
      .map(
        (t) =>
          `  ${t.name.padEnd(20)} leads=${t.lead_count.toString().padStart(5)} chốt=${t.converted.toString().padStart(4)} (${t.conversion_rate_pct.toFixed(2)}%)`
      ),
    ``,
    `=== HOẠT ĐỘNG ${ctx.recent_period_days} NGÀY GẦN ===`,
    `  Lead mới:        ${ctx.recent_new_leads.toLocaleString("vi-VN")}`,
    `  Chốt mới:        ${ctx.recent_conversions.toLocaleString("vi-VN")}`,
    ``,
    `=== ĐỊNH NGHĨA CANONICAL ===`,
    `- 1 học viên:        ${ENROLLED_STUDENT.rule} (caveat: ${ENROLLED_STUDENT.caveat?.slice(0, 80)}...)`,
    `- Lead:              ${LEAD.rule}`,
    `- Đã tư vấn:         ${CONSULTED.rule}`,
    `- Conversion rate:   ${CONVERSION_RATE.formula}`,
    `- Attribution rule:  ${ATTRIBUTION_RULE.current} (${ATTRIBUTION_RULE.rule.slice(0, 100)}...)`,
    `- CAC:               ${CAC.caveat?.slice(0, 100)}`,
    `- LTV:               ${LTV.caveat?.slice(0, 100)}`,
    ``,
    `=== CANONICAL SOURCES ===`,
    ...Object.entries(SOURCE_CHANNELS).map(
      ([k, v]) => `  ${k.padEnd(12)} = ${v.label} (${v.category})`
    ),
    ``,
    `Hãy phân tích snapshot này → trả về JSON growth plan đúng schema.`,
    `KHÔNG markdown wrap. Bắt đầu bằng '{', kết thúc bằng '}'.`,
  ];
  return lines.join("\n");
}

async function tryModels(
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
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

function repairTruncatedJson(s: string): string {
  let out = s;
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length > 0) {
    const open = stack.pop();
    out += open === "{" ? "}" : "]";
  }
  return out;
}

export async function generateGrowthPlan(ctx: GrowthContext): Promise<GrowthPlan> {
  const message = await tryModels({
    model: GROWTH_AI_MODEL,
    // Reduced from 12000 → 6000 to fit in Vercel function budget faster.
    // Schema is dense — 6K tokens enough for valid output.
    max_tokens: 6000,
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
        content: formatGrowthContext(ctx),
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  let raw =
    firstBrace >= 0 && lastBrace > firstBrace
      ? text.slice(firstBrace, lastBrace + 1)
      : text;
  raw = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    return JSON.parse(raw) as GrowthPlan;
  } catch {
    const toRepair = firstBrace >= 0 ? text.slice(firstBrace) : text;
    const repaired = repairTruncatedJson(toRepair);
    try {
      return JSON.parse(repaired) as GrowthPlan;
    } catch (e2) {
      throw new Error(
        `Failed to parse Growth Plan JSON (stop_reason=${message.stop_reason}): ${(e2 as Error).message}\nRaw start: ${text.slice(0, 200)}\nRaw end: ${text.slice(-200)}`
      );
    }
  }
}
