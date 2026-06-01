import type {
  Integration,
  SyncJob,
  ScoringRule,
  ReverseSyncMapping,
  LarkAlertRule,
  LarkAlertEvent,
  AITemplate,
  AIAuditLog,
  TeamMember,
  IdentityResolutionConfig,
} from "@/types/ops";

const h = (n: number) => new Date(Date.now() - n * 3600_000);

export const INTEGRATIONS: Integration[] = [
  {
    id: "salesforce",
    name: "Salesforce",
    category: "CRM",
    description: "Sales Cloud + Service Cloud — deal, contact, hoạt động tư vấn.",
    status: "connected",
    authType: "OAuth 2.0",
    lastSyncAt: h(3),
    recordCount: 4821,
  },
  {
    id: "smax",
    name: "SMAX",
    category: "Chat",
    description: "Chat trên fanpage, bot, auto-message.",
    status: "connected",
    authType: "API Key",
    lastSyncAt: h(2),
    recordCount: 12450,
  },
  {
    id: "instantly",
    name: "Instantly",
    category: "Email",
    description: "Email outreach + tracking open/click.",
    status: "error",
    authType: "API Key",
    lastSyncAt: h(28),
    recordCount: 8900,
    errorMessage: "Rate limit vượt ngưỡng lúc 02:14 — sẽ thử lại lúc 03:00.",
  },
  {
    id: "lark",
    name: "Lark Bot",
    category: "Webhook",
    description: "Gửi cảnh báo urgent đến TVV phụ trách qua DM/group.",
    status: "connected",
    authType: "Webhook URL",
    lastSyncAt: h(1),
  },
  {
    id: "fanpage",
    name: "Facebook Fanpage",
    category: "Social",
    description: "MasteringDataAnalytics + PhuongThaoAnalytics — đo lead nguồn.",
    status: "pending",
    authType: "OAuth 2.0",
  },
  {
    id: "web",
    name: "Website + Ads tracking",
    category: "Web",
    description: "Pageview, bài blog đọc, click bảng giá. (GA4 + GTM webhook)",
    status: "disconnected",
    authType: "Webhook URL",
  },
];

export const SYNC_JOBS: SyncJob[] = [
  { id: "j-001", source: "salesforce", startedAt: h(3), durationMs: 42_000, status: "success", recordsIn: 421, recordsMerged: 418 },
  { id: "j-002", source: "smax", startedAt: h(2), durationMs: 18_000, status: "success", recordsIn: 1245, recordsMerged: 1245 },
  { id: "j-003", source: "instantly", startedAt: h(28), durationMs: 5_000, status: "failed", recordsIn: 0, recordsMerged: 0, errors: ["HTTP 429 — rate limit"] },
  { id: "j-004", source: "salesforce", startedAt: h(27), durationMs: 51_000, status: "success", recordsIn: 503, recordsMerged: 498 },
  { id: "j-005", source: "smax", startedAt: h(26), durationMs: 22_000, status: "success", recordsIn: 1812, recordsMerged: 1810 },
  { id: "j-006", source: "instantly", startedAt: h(52), durationMs: 35_000, status: "success", recordsIn: 2210, recordsMerged: 2208 },
  { id: "j-007", source: "salesforce", startedAt: h(51), durationMs: 49_000, status: "success", recordsIn: 412, recordsMerged: 410 },
  { id: "j-008", source: "lark", startedAt: h(1), durationMs: 1_200, status: "success", recordsIn: 7, recordsMerged: 7 },
];

export const SCORING_RULES: ScoringRule[] = [
  { id: "h1", variant: "hot", signal: "email_open_count", signalLabel: "Mở email Instantly", operator: ">", threshold: 3, weight: 25, window: "7d", enabled: true },
  { id: "h2", variant: "hot", signal: "page_view_pricing", signalLabel: "Xem trang Bảng giá", operator: ">=", threshold: 1, weight: 30, window: "7d", enabled: true },
  { id: "h3", variant: "hot", signal: "chat_initiated_count", signalLabel: "Chủ động chat SMAX", operator: ">=", threshold: 1, weight: 20, window: "7d", enabled: true },
  { id: "h4", variant: "hot", signal: "form_submit", signalLabel: "Submit form tải tài liệu", operator: ">=", threshold: 1, weight: 15, window: "7d", enabled: true },
  { id: "c1", variant: "cold", signal: "days_since_last_contact", signalLabel: "Số ngày từ chạm gần nhất", operator: ">", threshold: 7, weight: 35, window: "30d", enabled: true },
  { id: "c2", variant: "cold", signal: "email_open_rate_drop", signalLabel: "Ngừng mở email", operator: ">", threshold: 5, weight: 25, window: "30d", enabled: true },
  { id: "c3", variant: "cold", signal: "deal_stage_age_days", signalLabel: "Deal đứng stage quá lâu", operator: ">", threshold: 14, weight: 30, window: "30d", enabled: true },
];

export const REVERSE_SYNC_MAPPINGS: ReverseSyncMapping[] = [
  { appField: "Điểm nóng (0-100)", sfField: "MDA_Hot_Score__c", object: "Contact", syncMode: "every_change", enabled: true, lastPushAt: h(2) },
  { appField: "Điểm nguội (0-100)", sfField: "MDA_Cold_Score__c", object: "Contact", syncMode: "every_change", enabled: true, lastPushAt: h(2) },
  { appField: "Lý do nóng (chuỗi)", sfField: "MDA_Hot_Reason__c", object: "Contact", syncMode: "daily", enabled: true, lastPushAt: h(8) },
  { appField: "Lần chạm gần nhất", sfField: "MDA_Last_Touch__c", object: "Contact", syncMode: "every_change", enabled: true, lastPushAt: h(2) },
  { appField: "Giai đoạn vòng đời", sfField: "MDA_Stage__c", object: "Opportunity", syncMode: "daily", enabled: false },
];

export const LARK_ALERT_RULES: LarkAlertRule[] = [
  {
    id: "lr1",
    name: "Lead nóng + quá hạn 4h chưa gọi",
    condition: "hot_score >= 80 AND last_call_age_hours > 4",
    channel: "DM",
    targetName: "TVV phụ trách",
    throttlePerDay: 5,
    dedupeWindowHours: 24,
    enabled: true,
    sentToday: 2,
  },
  {
    id: "lr2",
    name: "Lead nóng cực cao (>90) chưa được giao",
    condition: "hot_score > 90 AND assignee IS NULL",
    channel: "Group",
    targetName: "Group Sales",
    throttlePerDay: 10,
    dedupeWindowHours: 12,
    enabled: true,
    sentToday: 1,
  },
  {
    id: "lr3",
    name: "Deal đứng stage quá 14 ngày",
    condition: "deal_stage_age_days > 14",
    channel: "DM",
    targetName: "Manager",
    throttlePerDay: 3,
    dedupeWindowHours: 48,
    enabled: false,
    sentToday: 0,
  },
];

export const LARK_ALERT_HISTORY: LarkAlertEvent[] = [
  { id: "e1", ruleName: "Lead nóng + quá hạn 4h", leadName: "Nguyễn Văn An", reason: "92 điểm · Click bảng giá 2 lần · chưa gọi 5h", sentAt: h(0.5), delivered: true },
  { id: "e2", ruleName: "Lead nóng + quá hạn 4h", leadName: "Trần Thị Bích Ngọc", reason: "88 điểm · Chat hỏi học phí · chưa gọi 4h", sentAt: h(2), delivered: true },
  { id: "e3", ruleName: "Lead nóng cực cao", leadName: "Phạm Quốc Đạt", reason: "81 điểm · Lead mới chưa giao TVV", sentAt: h(6), delivered: true },
  { id: "e4", ruleName: "Lead nóng + quá hạn 4h", leadName: "Lê Hồng Phương", reason: "76 điểm · Mở 5 email · chưa gọi", sentAt: h(22), delivered: false },
];

export const AI_TEMPLATES: AITemplate[] = [
  { id: "t1", name: "Email follow-up sau khi click bảng giá", scenario: "Lead xem bảng giá nhưng chưa quyết định", channel: "Email", language: "vi", systemPrompt: "Bạn là TVV MDA, viết email tiếng Việt thân thiện, không sale-y...", enabled: true },
  { id: "t2", name: "Tin nhắn SMAX xác nhận lịch học", scenario: "Lead chat hỏi về lịch học cụ thể", channel: "SMAX Chat", language: "vi", systemPrompt: "Viết tin nhắn ngắn (<200 từ) xác nhận thông tin lớp...", enabled: true },
  { id: "t3", name: "Email cứu lead nguội", scenario: "Lead 7+ ngày không phản hồi", channel: "Email", language: "vi", systemPrompt: "Viết email re-engage không gây áp lực, cá nhân hóa theo khóa quan tâm...", enabled: true },
  { id: "t4", name: "Case study học viên thành công", scenario: "Lead đang cân nhắc giữa 2 khóa", channel: "Email", language: "vi", systemPrompt: "Chọn 1 case study phù hợp nhất với background của lead...", enabled: true },
  { id: "t5", name: "SMS nhắc lịch demo", scenario: "Lead đặt demo nhưng chưa xác nhận", channel: "SMS", language: "vi", systemPrompt: "Viết SMS <160 ký tự, lịch sự nhắc giờ demo...", enabled: false },
];

export const AI_AUDIT_LOG: AIAuditLog[] = [
  { id: "a1", templateName: "Email follow-up sau khi click bảng giá", leadName: "Nguyễn Văn An", generatedAt: h(0.3), approvedBy: "Phương Thảo", approvedAt: h(0.2), status: "sent", preview: "Chào An, em thấy anh vừa xem trang khóa Power BI..." },
  { id: "a2", templateName: "Tin nhắn SMAX xác nhận lịch học", leadName: "Trần Thị Bích Ngọc", generatedAt: h(2), approvedBy: "Minh Trí", approvedAt: h(1.8), status: "sent", preview: "Dạ chị Ngọc, lớp tối T7 ngày 8/6 vẫn còn 3 chỗ..." },
  { id: "a3", templateName: "Email cứu lead nguội", leadName: "Vũ Anh Tuấn", generatedAt: h(5), status: "draft", preview: "Chào Tuấn, lâu rồi không thấy anh ghé, em viết riêng..." },
  { id: "a4", templateName: "Email follow-up sau khi click bảng giá", leadName: "Hoàng Mai Linh", generatedAt: h(8), approvedBy: "Phương Thảo", approvedAt: h(7.5), status: "rejected", preview: "Chào Linh, em thấy chị quan tâm khóa Tableau..." },
];

export const TEAM_MEMBERS: TeamMember[] = [
  { id: "u1", name: "Trần Hoàng Anh", email: "anh.tran@mastering-da.com", role: "Admin", avatarColor: "#E0E7FF", leadCount: 0, active: true },
  { id: "u2", name: "Phương Thảo", email: "thao.phuong@mastering-da.com", role: "Manager", avatarColor: "#FFE3F0", leadCount: 23, active: true },
  { id: "u3", name: "Minh Trí", email: "tri.minh@mastering-da.com", role: "TVV", avatarColor: "#DCFCE7", leadCount: 47, active: true },
  { id: "u4", name: "Nguyễn Thu Hằng", email: "hang.nguyen@mastering-da.com", role: "TVV", avatarColor: "#FEF3C7", leadCount: 38, active: true },
  { id: "u5", name: "Lê Đức Mạnh", email: "manh.le@mastering-da.com", role: "TVV", avatarColor: "#E0F2FE", leadCount: 41, active: true },
  { id: "u6", name: "Vũ Khánh Linh", email: "linh.vu@mastering-da.com", role: "Viewer", avatarColor: "#EDE9FE", leadCount: 0, active: false },
];

export const IDENTITY_CONFIG: IdentityResolutionConfig = {
  primaryField: "email",
  fuzzyEnabled: true,
  llmFallbackEnabled: true,
  unmergedCount: 142,
  llmCallsThisMonth: 89,
};

export const SOURCE_LABEL: Record<string, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  lark: "Lark Bot",
  fanpage: "Fanpage",
  web: "Website",
};
