import type {
  ChannelAttribution,
  FunnelStep,
  Cohort,
  HighValueSegment,
  GrowthHypothesis,
  GrowthOverviewKPI,
} from "@/types/growth";

export const GROWTH_KPI: GrowthOverviewKPI = {
  newEnrollmentsMonth: { value: 142, deltaPct: 18, deltaPositive: true },
  revenueMonthVnd: { value: 1_278_000_000, deltaPct: 22, deltaPositive: true },
  avgCacVnd: { value: 2_450_000, deltaPct: 8, deltaPositive: false },
  funnelConversion: { value: 4.7, deltaPct: 0.6, deltaPositive: true },
};

export const ATTRIBUTION_BY_CHANNEL: ChannelAttribution[] = [
  {
    channel: "fanpage_phuongthao",
    channelLabel: "Fanpage PhuongThao",
    leads: 412,
    consulted: 198,
    enrolled: 53,
    revenueVnd: 477_000_000,
    spendVnd: 25_000_000,
    cacVnd: 471_698,
    conversionPct: 12.9,
  },
  {
    channel: "fanpage_brand",
    channelLabel: "Fanpage Brand",
    leads: 789,
    consulted: 312,
    enrolled: 37,
    revenueVnd: 333_000_000,
    spendVnd: 48_000_000,
    cacVnd: 1_297_297,
    conversionPct: 4.7,
  },
  {
    channel: "google_ads",
    channelLabel: "Google Ads",
    leads: 521,
    consulted: 245,
    enrolled: 31,
    revenueVnd: 279_000_000,
    spendVnd: 95_000_000,
    cacVnd: 3_064_516,
    conversionPct: 5.9,
  },
  {
    channel: "seo",
    channelLabel: "SEO / Organic",
    leads: 234,
    consulted: 98,
    enrolled: 18,
    revenueVnd: 162_000_000,
    spendVnd: 12_000_000,
    cacVnd: 666_666,
    conversionPct: 7.7,
  },
  {
    channel: "facebook_ads",
    channelLabel: "Facebook Ads",
    leads: 678,
    consulted: 201,
    enrolled: 12,
    revenueVnd: 108_000_000,
    spendVnd: 87_000_000,
    cacVnd: 7_250_000,
    conversionPct: 1.8,
  },
  {
    channel: "tiktok_ads",
    channelLabel: "TikTok Ads",
    leads: 1_245,
    consulted: 187,
    enrolled: 8,
    revenueVnd: 72_000_000,
    spendVnd: 64_000_000,
    cacVnd: 8_000_000,
    conversionPct: 0.6,
  },
];

export const FUNNEL_STEPS: FunnelStep[] = [
  { key: "visitor", label: "Visitor (truy cập web)", count: 18_420 },
  { key: "lead", label: "Lead (để lại thông tin)", count: 3_879, conversionFromPrev: 21.1 },
  { key: "consulted", label: "Đã tư vấn", count: 1_241, conversionFromPrev: 32.0 },
  { key: "enrolled", label: "Ghi danh (đóng tiền)", count: 159, conversionFromPrev: 12.8, isDropoffBig: true },
  { key: "started", label: "Bắt đầu học", count: 152, conversionFromPrev: 95.6 },
];

export const COHORTS: Cohort[] = [
  { month: "2026-01", size: 124, source: "Tổng", retention: { m0: 100, m1: 92, m2: 88, m3: 85 } },
  { month: "2026-02", size: 138, source: "Tổng", retention: { m0: 100, m1: 94, m2: 89, m3: 0 } },
  { month: "2026-03", size: 156, source: "Tổng", retention: { m0: 100, m1: 91, m2: 0, m3: 0 } },
  { month: "2026-04", size: 142, source: "Tổng", retention: { m0: 100, m1: 0, m2: 0, m3: 0 } },
];

export const HIGH_VALUE_SEGMENTS: HighValueSegment[] = [
  {
    id: "s1",
    name: "Đọc ≥3 blog Power BI + đến từ PhuongThao",
    size: 187,
    baselineConvRate: 4.7,
    segmentConvRate: 14.2,
    liftMultiplier: 3.0,
    signals: ["≥3 bài blog Power BI đã đọc", "Nguồn = Fanpage PhuongThao", "Click bảng giá"],
    recommendedAction: "Xây tệp lookalike trên Facebook + ưu tiên TVV gọi trong 24h",
  },
  {
    id: "s2",
    name: "Marketer/Analyst chuyển ngành, 25-32 tuổi",
    size: 98,
    baselineConvRate: 4.7,
    segmentConvRate: 11.8,
    liftMultiplier: 2.5,
    signals: ["Form chuyển ngành = true", "Tuổi 25-32", "Có background business"],
    recommendedAction: "Email chuỗi 'Lộ trình chuyển ngành 6 tháng' + case study tương ứng",
  },
  {
    id: "s3",
    name: "Đã học khóa SQL miễn phí → quan tâm Power BI",
    size: 64,
    baselineConvRate: 4.7,
    segmentConvRate: 10.4,
    liftMultiplier: 2.2,
    signals: ["Hoàn thành SQL Free", "Click ≥1 lần trang Power BI"],
    recommendedAction: "Email upgrade với coupon 15% trong 7 ngày",
  },
];

export const GROWTH_HYPOTHESES: GrowthHypothesis[] = [
  {
    id: "h1",
    title: "Cắt 50% ngân sách TikTok Ads, dồn sang PhuongThao",
    context:
      "TikTok ra 1245 lead nhưng chỉ 8 học viên (CAC 8M). PhuongThao ra 412 lead nhưng 53 học viên (CAC 471K — rẻ gấp 17 lần).",
    hypothesis:
      "Dồn 32M từ TikTok sang booster Fanpage PhuongThao có thể tăng thêm ~40 học viên/tháng cùng ngân sách.",
    proposedExperiment:
      "Cắt 50% ngân sách TikTok trong 2 tuần, dồn ngân sách sang PhuongThao. So sánh số học viên thu được.",
    expectedImpact: "+25-40 học viên/tháng cùng ngân sách",
    confidence: "high",
    dataSources: ["fact_attribution", "dim_channel_spend"],
  },
  {
    id: "h2",
    title: "Test chuỗi nurture 7 ngày ở khâu 'Đã tư vấn → Ghi danh'",
    context:
      "Phễu rò rỉ lớn nhất: 'Đã tư vấn' (1241) → 'Ghi danh' (159) = chỉ 12.8%. 1082 lead đã tư vấn nhưng không chốt.",
    hypothesis:
      "Lead sau tư vấn cần thêm 5-7 điểm chạm trước khi chốt. Hiện chỉ có 2-3 điểm chạm trung bình.",
    proposedExperiment:
      "A/B test: nhóm A nhận chuỗi 7 email + 1 case study sau tư vấn. Nhóm B (control) như hiện tại.",
    expectedImpact: "+3-5pp tỷ lệ chốt sau tư vấn = +30-50 học viên/tháng",
    confidence: "medium",
    dataSources: ["fact_touchpoint", "fact_funnel_step", "dim_consultation"],
  },
  {
    id: "h3",
    title: "Build lookalike từ phân khúc 'Power BI + PhuongThao' lên FB/Google",
    context:
      "Phân khúc này chốt với tỷ lệ 14.2% — gấp 3 lần baseline. Hiện chỉ có 187 lead, mở rộng tệp lookalike có thể nhân lên.",
    hypothesis:
      "Người tương tự (cùng demo + interest) sẽ chốt tốt hơn lead random từ ads.",
    proposedExperiment:
      "Export 187 lead này thành audience → upload FB/Google → tạo 1% lookalike → chạy 2 tuần thử nghiệm.",
    expectedImpact: "+15-25 học viên/tháng với CAC dự kiến < 1.5M",
    confidence: "medium",
    dataSources: ["dim_lead", "fact_blog_read", "dim_segment"],
  },
];

export const CHANNEL_LABEL: Record<string, string> = {
  google_ads: "Google Ads",
  facebook_ads: "Facebook Ads",
  tiktok_ads: "TikTok Ads",
  fanpage_brand: "Fanpage Brand",
  fanpage_phuongthao: "Fanpage PhuongThao",
  seo: "SEO",
  direct: "Direct",
  referral: "Referral",
};

export function formatVnd(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toString();
}
