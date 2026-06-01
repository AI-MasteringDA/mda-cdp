export type IntegrationStatus = "connected" | "error" | "disconnected" | "pending";

export interface Integration {
  id: "salesforce" | "smax" | "instantly" | "lark" | "fanpage" | "web";
  name: string;
  category: "CRM" | "Chat" | "Email" | "Webhook" | "Web" | "Social";
  description: string;
  status: IntegrationStatus;
  authType: "OAuth 2.0" | "API Key" | "Webhook URL";
  lastSyncAt?: Date;
  recordCount?: number;
  errorMessage?: string;
}

export type SyncJobStatus = "success" | "running" | "failed" | "scheduled";

export interface SyncJob {
  id: string;
  source: Integration["id"];
  startedAt: Date;
  durationMs?: number;
  status: SyncJobStatus;
  recordsIn: number;
  recordsMerged: number;
  errors?: string[];
}

export type ScoringSignal =
  | "email_open_count"
  | "email_click_count"
  | "page_view_pricing"
  | "chat_initiated_count"
  | "form_submit"
  | "days_since_last_contact"
  | "deal_stage_age_days"
  | "email_open_rate_drop";

export interface ScoringRule {
  id: string;
  variant: "hot" | "cold";
  signal: ScoringSignal;
  signalLabel: string;
  operator: ">" | ">=" | "<" | "<=" | "==";
  threshold: number;
  weight: number;
  window: "24h" | "7d" | "30d";
  enabled: boolean;
}

export type ReverseSyncField =
  | "MDA_Hot_Score__c"
  | "MDA_Cold_Score__c"
  | "MDA_Hot_Reason__c"
  | "MDA_Last_Touch__c"
  | "MDA_Stage__c";

export interface ReverseSyncMapping {
  appField: string;
  sfField: ReverseSyncField;
  object: "Contact" | "Lead" | "Opportunity";
  syncMode: "every_change" | "daily" | "manual";
  enabled: boolean;
  lastPushAt?: Date;
}

export interface LarkAlertRule {
  id: string;
  name: string;
  condition: string;
  channel: "DM" | "Group";
  targetName: string;
  throttlePerDay: number;
  dedupeWindowHours: number;
  enabled: boolean;
  sentToday: number;
}

export interface LarkAlertEvent {
  id: string;
  ruleName: string;
  leadName: string;
  reason: string;
  sentAt: Date;
  delivered: boolean;
}

export interface AITemplate {
  id: string;
  name: string;
  scenario: string;
  channel: "Email" | "SMAX Chat" | "SMS";
  language: "vi" | "en";
  systemPrompt: string;
  enabled: boolean;
}

export interface AIAuditLog {
  id: string;
  templateName: string;
  leadName: string;
  generatedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  status: "draft" | "approved" | "sent" | "rejected";
  preview: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "Manager" | "TVV" | "Viewer";
  avatarColor: string;
  leadCount: number;
  active: boolean;
}

export interface IdentityResolutionConfig {
  primaryField: "email" | "phone" | "student_id";
  fuzzyEnabled: boolean;
  llmFallbackEnabled: boolean;
  unmergedCount: number;
  llmCallsThisMonth: number;
}
