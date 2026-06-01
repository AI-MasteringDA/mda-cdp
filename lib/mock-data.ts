import type { Lead, Touchpoint } from "@/types/lead";

const AVATAR_COLORS = [
  "#FFE5D9", "#FFE3F0", "#E0F2FE", "#DCFCE7", "#FEF3C7",
  "#EDE9FE", "#FCE7F3", "#E0E7FF",
];

function tp(
  id: string,
  source: Touchpoint["source"],
  type: Touchpoint["type"],
  title: string,
  hoursAgo: number,
  detail?: string
): Touchpoint {
  return {
    id,
    source,
    type,
    title,
    detail,
    occurredAt: new Date(Date.now() - hoursAgo * 3600_000),
  };
}

export const MOCK_LEADS: Lead[] = [
  {
    id: "L-001",
    name: "Nguyễn Văn An",
    email: "an.nguyen@gmail.com",
    phone: "+84 901 234 567",
    source: "fanpage",
    avatarColor: AVATAR_COLORS[0],
    hotScore: 92,
    coldScore: 12,
    hotReasons: ["Mở 4 email", "Click bảng giá", "Chat chủ động 2 lần"],
    coldReasons: [],
    lastContactAt: new Date(Date.now() - 3 * 3600_000),
    firstSeenAt: new Date(Date.now() - 14 * 24 * 3600_000),
    stage: "Đang cân nhắc",
    assignee: "Phương Thảo",
    touchpoints: [
      tp("t1", "web", "page_view", "Xem trang Bảng giá khóa Power BI", 2, "/courses/power-bi/pricing"),
      tp("t2", "instantly", "email_open", "Mở email: Lộ trình học Data Analyst", 5),
      tp("t3", "smax", "chat", "Hỏi về thời gian học buổi tối", 8, '"Lớp tối thứ 7 có còn chỗ không ạ?"'),
      tp("t4", "instantly", "email_click", "Click link tài liệu mẫu", 26),
      tp("t5", "salesforce", "call", "Tư vấn viên gọi - 4 phút", 48),
      tp("t6", "web", "form_submit", "Đăng ký nhận tài liệu lộ trình", 72),
    ],
  },
  {
    id: "L-002",
    name: "Trần Thị Bích Ngọc",
    email: "ngoc.tranthi@outlook.com",
    phone: "+84 912 555 888",
    source: "fanpage",
    avatarColor: AVATAR_COLORS[1],
    hotScore: 88,
    coldScore: 18,
    hotReasons: ["Click bảng giá 3 lần", "Chat hỏi học phí"],
    coldReasons: [],
    lastContactAt: new Date(Date.now() - 5 * 3600_000),
    firstSeenAt: new Date(Date.now() - 7 * 24 * 3600_000),
    stage: "Đang tư vấn",
    assignee: "Minh Trí",
    touchpoints: [
      tp("t1", "web", "page_view", "Xem Bảng giá khóa SQL", 1),
      tp("t2", "smax", "chat", "Hỏi về tài liệu sau khóa", 5),
      tp("t3", "instantly", "email_open", "Mở email: Roadmap Data", 10),
    ],
  },
  {
    id: "L-003",
    name: "Phạm Quốc Đạt",
    email: "dat.phamquoc@gmail.com",
    phone: "+84 938 222 110",
    source: "web",
    avatarColor: AVATAR_COLORS[2],
    hotScore: 81,
    coldScore: 22,
    hotReasons: ["Đọc 3 bài blog", "Xem trang khóa Python"],
    coldReasons: [],
    lastContactAt: new Date(Date.now() - 12 * 3600_000),
    firstSeenAt: new Date(Date.now() - 5 * 24 * 3600_000),
    stage: "Mới",
    assignee: "Phương Thảo",
    touchpoints: [
      tp("t1", "web", "page_view", "Đọc blog: Lộ trình từ 0 đến Data Analyst", 4),
      tp("t2", "web", "page_view", "Xem trang khóa Python for Data", 6),
    ],
  },
  {
    id: "L-004",
    name: "Lê Hồng Phương",
    email: "phuong.le@yahoo.com",
    phone: "+84 977 010 234",
    source: "salesforce",
    avatarColor: AVATAR_COLORS[3],
    hotScore: 76,
    coldScore: 28,
    hotReasons: ["Mở 5 email gần nhất"],
    coldReasons: [],
    lastContactAt: new Date(Date.now() - 18 * 3600_000),
    firstSeenAt: new Date(Date.now() - 21 * 24 * 3600_000),
    stage: "Đang cân nhắc",
    assignee: "Minh Trí",
    touchpoints: [
      tp("t1", "instantly", "email_open", "Mở email: Ưu đãi khóa T6", 8),
      tp("t2", "salesforce", "call", "Gọi tư vấn không bắt máy", 24),
    ],
  },
  {
    id: "L-005",
    name: "Hoàng Mai Linh",
    email: "linh.hoangmai@gmail.com",
    phone: "+84 905 678 999",
    source: "fanpage",
    avatarColor: AVATAR_COLORS[4],
    hotScore: 74,
    coldScore: 30,
    hotReasons: ["Xem 2 lần trang bảng giá", "Tải tài liệu"],
    coldReasons: [],
    lastContactAt: new Date(Date.now() - 22 * 3600_000),
    firstSeenAt: new Date(Date.now() - 9 * 24 * 3600_000),
    stage: "Đang tư vấn",
    assignee: "Phương Thảo",
    touchpoints: [
      tp("t1", "web", "form_submit", "Tải tài liệu Lộ trình BI", 10),
      tp("t2", "web", "page_view", "Bảng giá khóa Tableau", 30),
    ],
  },
  {
    id: "L-101",
    name: "Vũ Anh Tuấn",
    email: "tuan.vu@gmail.com",
    phone: "+84 909 111 222",
    source: "salesforce",
    avatarColor: AVATAR_COLORS[5],
    hotScore: 24,
    coldScore: 86,
    hotReasons: [],
    coldReasons: ["Không phản hồi 9 ngày", "Ngừng mở email", "Deal đứng stage 3 tuần"],
    lastContactAt: new Date(Date.now() - 9 * 24 * 3600_000),
    firstSeenAt: new Date(Date.now() - 45 * 24 * 3600_000),
    stage: "Im lặng",
    assignee: "Minh Trí",
    touchpoints: [
      tp("t1", "salesforce", "call", "Tư vấn lần 2 - không phản hồi", 216),
      tp("t2", "instantly", "email_open", "Mở email theo dõi", 240),
    ],
  },
  {
    id: "L-102",
    name: "Đặng Thu Hà",
    email: "ha.dangthu@hotmail.com",
    phone: "+84 938 444 777",
    source: "fanpage",
    avatarColor: AVATAR_COLORS[6],
    hotScore: 18,
    coldScore: 82,
    hotReasons: [],
    coldReasons: ["Đã tư vấn 14 ngày trước", "Không mở email 10 ngày"],
    lastContactAt: new Date(Date.now() - 14 * 24 * 3600_000),
    firstSeenAt: new Date(Date.now() - 35 * 24 * 3600_000),
    stage: "Im lặng",
    assignee: "Phương Thảo",
    touchpoints: [
      tp("t1", "salesforce", "call", "Tư vấn lần đầu - 12 phút", 336),
    ],
  },
  {
    id: "L-103",
    name: "Bùi Tiến Dũng",
    email: "dung.bt@gmail.com",
    phone: "+84 901 999 333",
    source: "instantly",
    avatarColor: AVATAR_COLORS[7],
    hotScore: 22,
    coldScore: 78,
    hotReasons: [],
    coldReasons: ["Bỏ ngỏ 7 ngày", "Click 1 lần rồi im"],
    lastContactAt: new Date(Date.now() - 7 * 24 * 3600_000),
    firstSeenAt: new Date(Date.now() - 28 * 24 * 3600_000),
    stage: "Im lặng",
    assignee: "Minh Trí",
    touchpoints: [
      tp("t1", "instantly", "email_click", "Click link trong email", 168),
    ],
  },
];

export const KPI_TODAY = {
  hotToday: { value: 23, deltaPct: 12, deltaPositive: true },
  coldToRescue: { value: 47, deltaPct: 8, deltaPositive: false },
  consultedWeek: { value: 156, deltaPct: 4, deltaPositive: true },
  conversionRate: { value: 18.4, deltaPct: 1.2, deltaPositive: true },
};

export const RECENT_ACTIVITIES = [
  { id: "a1", lead: "Nguyễn Văn An", action: "click trang bảng giá", source: "web", at: new Date(Date.now() - 12 * 60_000) },
  { id: "a2", lead: "Trần Thị Bích Ngọc", action: "chat hỏi học phí qua SMAX", source: "smax", at: new Date(Date.now() - 38 * 60_000) },
  { id: "a3", lead: "Phạm Quốc Đạt", action: "mở email lộ trình", source: "instantly", at: new Date(Date.now() - 75 * 60_000) },
  { id: "a4", lead: "Hoàng Mai Linh", action: "tải tài liệu Lộ trình BI", source: "web", at: new Date(Date.now() - 180 * 60_000) },
  { id: "a5", lead: "Lê Hồng Phương", action: "gọi không bắt máy", source: "salesforce", at: new Date(Date.now() - 240 * 60_000) },
];

export function getLeadById(id: string): Lead | undefined {
  return MOCK_LEADS.find((l) => l.id === id);
}

export const HOT_LEADS = MOCK_LEADS.filter((l) => l.hotScore >= 70).sort(
  (a, b) => b.hotScore - a.hotScore
);
export const COLD_LEADS = MOCK_LEADS.filter((l) => l.coldScore >= 70).sort(
  (a, b) => b.coldScore - a.coldScore
);
