export type LeadSource = "salesforce" | "smax" | "instantly" | "web" | "fanpage";

export type TouchpointType =
  | "lead_created"
  | "email_open"
  | "email_click"
  | "email_sent"
  | "email_reply"
  | "chat"
  | "chat_staff"
  | "page_view"
  | "call"
  | "meeting"
  | "note"
  | "form_submit"
  | "conversion"
  | "lost"
  | "attachment";

export interface Touchpoint {
  id: string;
  source: LeadSource;
  type: TouchpointType;
  title: string;
  detail?: string;
  occurredAt: Date;
  /**
   * For SMAX events: true=TVV/MDA staff, false=Lead, null=unknown (legacy data)
   * For non-SMAX events: undefined (sender concept doesn't apply)
   */
  senderIsStaff?: boolean | null;
}

export type LeadTier = "NÓNG" | "ẤM" | "MÁT" | "NGỦ ĐÔNG";

export interface ScoreReason {
  sign: "+" | "-";
  label: string;
  points: number;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: LeadSource;
  avatarColor: string;
  // V5: unified score 0-100 + categorical tier
  score: number;
  tier: LeadTier;
  reasons: ScoreReason[];
  // Deprecated, kept for backward-compat (will be removed)
  hotScore: number;
  coldScore: number;
  hotReasons: string[];
  coldReasons: string[];
  lastContactAt: Date;
  firstSeenAt: Date;
  stage: "Mới" | "Đang tư vấn" | "Đang cân nhắc" | "Im lặng" | "Đã chốt";
  assignee: string;
  company?: string | null;
  leadSource?: string | null;
  sfProduct?: string | null;
  sfRating?: string | null;
  sfStatus?: string | null;
  touchpoints: Touchpoint[];
}

export function scoreToTier(score: number): LeadTier {
  if (score >= 70) return "NÓNG";
  if (score >= 40) return "ẤM";
  if (score >= 20) return "MÁT";
  return "NGỦ ĐÔNG";
}
