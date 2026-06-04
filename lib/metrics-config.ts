/**
 * MDA Platform — Canonical Metric Definitions
 *
 * Spec ref: REQUEST App 2 Growth Insight — section 4 ("Tầng metric dùng chung")
 *
 * Mọi chỉ số trong app PHẢI tham chiếu file này. KHÔNG hard-code định nghĩa
 * ở từng query/component — đó là nguồn gây "hai app cãi nhau về cùng 1 số".
 *
 * Khi muốn thay đổi định nghĩa: sửa Ở ĐÂY, không sửa ad-hoc trong queries.ts.
 */

export type MetricDefinition = {
  /** Tên hiển thị tiếng Việt */
  label: string;
  /** Mô tả ngắn (1 câu) */
  description: string;
  /** Operational definition — câu cụ thể "tính như thế nào" */
  rule: string;
  /** SQL/query reference cho debug */
  formula?: string;
  /** Caveat / known limitation */
  caveat?: string;
};

/**
 * "1 HỌC VIÊN" — định nghĩa quan trọng nhất theo spec mục 4 + 8.2
 * Hiện tại MDA chưa import revenue → dùng heuristic conversion event.
 * Phase 2 sẽ nâng cấp khi có Salesforce Opportunity data.
 */
export const ENROLLED_STUDENT: MetricDefinition = {
  label: "Học viên (enrolled)",
  description: "Người đã có ít nhất 1 conversion event trong fact_touchpoint.",
  rule: "dim_lead.conversion_count > 0",
  formula: "COUNT(DISTINCT lead_id) WHERE conversion_count > 0",
  caveat:
    "Heuristic v1 — chưa phân biệt 'đã đóng tiền' vs 'đã học buổi đầu'. " +
    "Cần Salesforce Opportunity stage hoặc payment data để chính xác hơn. " +
    "Hiện tại có thể overcount nếu conversion event = lead đăng ký free webinar.",
};

/**
 * "LEAD" — bước đầu phễu
 */
export const LEAD: MetricDefinition = {
  label: "Lead",
  description: "Người đã được nhận diện trong hệ thống (có ít nhất 1 touchpoint).",
  rule: "Row trong dim_lead bất kỳ stage nào",
  formula: "COUNT(*) FROM dim_lead",
};

/**
 * "ĐÃ TƯ VẤN" — bước giữa phễu
 */
export const CONSULTED: MetricDefinition = {
  label: "Đã tư vấn",
  description:
    "Lead có ít nhất 2 touchpoint (nghĩa là đã engaged ngoài việc chỉ được tạo).",
  rule: "dim_lead.total_touchpoints > 1",
  formula: "COUNT(*) FROM dim_lead WHERE total_touchpoints > 1",
  caveat: "Heuristic — TVV chưa có cách đánh dấu rõ 'đã có cuộc tư vấn 1-1'.",
};

/**
 * "GHI DANH" — bước gần cuối phễu (giữa tư vấn và chốt)
 */
export const REGISTERED: MetricDefinition = {
  label: "Ghi danh",
  description:
    "Lead có chat (lead-side) hoặc reply email — đang trong giai đoạn cân nhắc.",
  rule: "chat_count > 0 OR email_reply_count > 0",
  caveat: "Hiện chưa tách rõ stage này khỏi 'đã tư vấn'.",
};

/**
 * "ATTRIBUTION RULE" — quy tắc gán học viên về kênh
 * Spec yêu cầu chọn 1: first / last / linear / multi-touch
 */
export const ATTRIBUTION_RULE = {
  current: "first-touch" as const,
  rule:
    "Gán mỗi học viên về `dim_lead.source` (nguồn đầu tiên match identity). " +
    "Đây là first-touch — kênh khám phá ra lead.",
  alternatives: {
    "first-touch": "Kênh tạo lead lần đầu (current)",
    "last-touch": "Kênh có touchpoint cuối trước conversion",
    "linear": "Chia đều giá trị cho mọi kênh có touchpoint",
    "multi-touch": "Weighted decay theo thời gian gần conversion",
  },
  caveat:
    "Cần team chọn (spec mục 8.1). Hiện dùng first-touch vì đơn giản nhất " +
    "và đủ đo 'kênh nào nuôi được lead'.",
};

/**
 * "CONVERSION RATE" — tỷ lệ chốt
 */
export const CONVERSION_RATE: MetricDefinition = {
  label: "Tỷ lệ chuyển đổi",
  description: "Tỷ lệ lead trở thành học viên.",
  rule: "ENROLLED_STUDENT / LEAD",
  formula: "COUNT(conversion_count > 0) / COUNT(*) * 100",
};

/**
 * "CAC" — Customer Acquisition Cost
 * KHÔNG có data spend → chưa tính được. Báo trống honest.
 */
export const CAC: MetricDefinition = {
  label: "CAC (Customer Acquisition Cost)",
  description: "Chi phí để có 1 học viên.",
  rule: "TỔNG ad spend / TỔNG học viên (theo kênh)",
  caveat:
    "CHƯA TÍNH ĐƯỢC vì spend data từ Google/FB/TikTok Ads chưa được ingest. " +
    "Bước tiếp theo: dựng ETL spend → join với attribution.",
};

/**
 * "LTV" — Lifetime Value
 */
export const LTV: MetricDefinition = {
  label: "LTV (Lifetime Value)",
  description: "Doanh thu trung bình từ 1 học viên trong toàn vòng đời.",
  rule: "TỔNG revenue (1 học viên qua tất cả khóa) — trung bình",
  caveat:
    "CHƯA TÍNH ĐƯỢC vì chưa import Salesforce Opportunity với revenue. " +
    "Hiện chỉ đo được số học viên, chưa đo được giá trị.",
};

/**
 * Map sources → kênh marketing canonical
 * Tham khảo trong UI để consistent labelling
 */
export const SOURCE_CHANNELS: Record<
  string,
  { label: string; category: "paid" | "organic" | "owned" | "partner"; color: string }
> = {
  salesforce: { label: "Salesforce (CRM)",   category: "owned",   color: "#00a1e0" },
  smax:       { label: "SMAX (Chat)",         category: "owned",   color: "#7c3aed" },
  instantly:  { label: "Instantly (Email)",   category: "owned",   color: "#f59e0b" },
  web:        { label: "Wix Website",          category: "organic", color: "#10b981" },
  fanpage:    { label: "Facebook Fanpage",     category: "organic", color: "#1877f2" },
  lark:       { label: "Lark Bot",             category: "owned",   color: "#10b981" },
};

/**
 * SMAX page_pid → kênh chi tiết
 * Tham khảo cho channel attribution within SMAX
 */
export const SMAX_PAGES: Record<string, { label: string; category: string }> = {
  fb102323788540150:           { label: "Facebook Brand",        category: "fanpage" },
  fb107203051058856:           { label: "Facebook KOL PhuongThao", category: "kol" },
  zlw543187459113764384:       { label: "Zalo Main",              category: "messenger" },
  zl2235256473219383054:       { label: "Zalo Other",             category: "messenger" },
  ctm68188e11779d16c0779c018c: { label: "Website Live Chat",      category: "owned" },
  ig17841446528067260:         { label: "Instagram Brand",        category: "fanpage" },
  ig17841460097450702:         { label: "Instagram KOL",          category: "kol" },
};

/**
 * SQL filters tương ứng các định nghĩa trên — dùng cho Supabase queries
 */
export const SQL_FILTERS = {
  isEnrolledStudent: { column: "conversion_count", op: "gt", value: 0 },
  isConsulted: { column: "total_touchpoints", op: "gt", value: 1 },
  isRegistered: { column: "chat_count", op: "gt", value: 0 },
} as const;

/**
 * Cluster of definitions for UI display + AI context
 */
export const ALL_METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  enrolled_student: ENROLLED_STUDENT,
  lead: LEAD,
  consulted: CONSULTED,
  registered: REGISTERED,
  conversion_rate: CONVERSION_RATE,
  cac: CAC,
  ltv: LTV,
};
