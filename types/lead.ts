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
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: LeadSource;
  avatarColor: string;
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
  touchpoints: Touchpoint[];
}
