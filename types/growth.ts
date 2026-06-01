export type Channel =
  | "google_ads"
  | "facebook_ads"
  | "tiktok_ads"
  | "fanpage_brand"
  | "fanpage_phuongthao"
  | "seo"
  | "direct"
  | "referral";

export interface ChannelAttribution {
  channel: Channel;
  channelLabel: string;
  leads: number;
  consulted: number;
  enrolled: number;
  revenueVnd: number;
  spendVnd: number;
  cacVnd: number;
  conversionPct: number;
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  conversionFromPrev?: number;
  isDropoffBig?: boolean;
}

export interface Cohort {
  month: string;
  size: number;
  retention: { m0: number; m1: number; m2: number; m3: number };
  source: string;
}

export interface HighValueSegment {
  id: string;
  name: string;
  size: number;
  baselineConvRate: number;
  segmentConvRate: number;
  liftMultiplier: number;
  signals: string[];
  recommendedAction: string;
}

export interface GrowthHypothesis {
  id: string;
  title: string;
  context: string;
  hypothesis: string;
  proposedExperiment: string;
  expectedImpact: string;
  confidence: "low" | "medium" | "high";
  dataSources: string[];
}

export interface GrowthOverviewKPI {
  newEnrollmentsMonth: { value: number; deltaPct: number; deltaPositive: boolean };
  revenueMonthVnd: { value: number; deltaPct: number; deltaPositive: boolean };
  avgCacVnd: { value: number; deltaPct: number; deltaPositive: boolean };
  funnelConversion: { value: number; deltaPct: number; deltaPositive: boolean };
}
