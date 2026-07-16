import type { Lead, Touchpoint } from "@/types/lead";

/**
 * Các chỉ số "phái sinh" cho trang hồ sơ 360° (bám layout Antsomi nhưng đổi
 * ruột ecommerce → ruột lead B2B). Tất cả đều là HEURISTIC minh bạch, không
 * phải ML — nên chỗ hiển thị luôn ghi "ước tính".
 */

/** Điểm 0-100 → số sao 0-5 (bước 0.5), giống rating của Antsomi. */
export function scoreToStars(score: number): number {
  return Math.round((score / 100) * 10) / 2;
}

/**
 * "Xác suất chốt (ước tính)" — thay cho "Predicted to spend" của Antsomi.
 * Lấy điểm scoring làm gốc, cộng thưởng nếu lead có hành vi chủ động thật.
 */
export function closeProbability(lead: Lead): number {
  const base = lead.score * 0.9;
  const engaged = lead.signals?.hasRealEngagement ? 8 : 0;
  return Math.max(2, Math.min(96, Math.round(base + engaged)));
}

export function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

/**
 * "Nguy cơ nguội (ước tính)" — thay cho "Churn risk" của Antsomi.
 * Chủ yếu theo độ im lặng (ngày kể từ tương tác cuối), nhích theo tier.
 */
export function churnRisk(lead: Lead): number {
  const d = daysSince(lead.lastContactAt);
  let risk: number;
  if (d < 7) risk = 12;
  else if (d < 14) risk = 25;
  else if (d < 30) risk = 45;
  else if (d < 60) risk = 65;
  else if (d < 90) risk = 80;
  else risk = 92;
  if (lead.tier === "NÓNG") risk -= 10;
  else if (lead.tier === "NGỦ ĐÔNG") risk += 6;
  if (lead.signals && !lead.signals.hasRealEngagement) risk += 5;
  return Math.max(3, Math.min(97, Math.round(risk)));
}

export type Tone = "hot" | "warm" | "cool" | "dormant";

export interface LifecycleLabel {
  label: string;
  tone: Tone;
}

/** Nhãn vòng đời — thay cho "Gold buyer / Defecting customer" của Antsomi. */
export function lifecycleLabel(lead: Lead): LifecycleLabel {
  switch (lead.tier) {
    case "NÓNG":
      return { label: "Khách tiềm năng cao", tone: "hot" };
    case "ẤM":
      return { label: "Đang quan tâm", tone: "warm" };
    case "MÁT":
      return { label: "Cần hâm nóng", tone: "cool" };
    default:
      return { label: "Đang nguội dần", tone: "dormant" };
  }
}

export type Channel = "email" | "chat" | "web" | "phone";

/** Kênh mà lead đang hiện diện — thay cho hàng icon 📞✉️💬 của Antsomi. */
export function activeChannels(lead: Lead): Channel[] {
  const s = lead.signals;
  const ch: Channel[] = [];
  if (lead.email || (s && s.emailOpens + s.emailClicks + s.emailReplies > 0)) ch.push("email");
  if ((s && s.chats > 0) || lead.source === "smax" || lead.source === "fanpage") ch.push("chat");
  if (s && s.webViews > 0) ch.push("web");
  if (lead.phone) ch.push("phone");
  return ch;
}

/** Heatmap 7 ngày × 6 khung giờ (giờ VN, UTC+7) — thay "Day & hour" của Antsomi. */
export const HEATMAP_DAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
export const HEATMAP_BUCKETS = ["0-4h", "4-8h", "8-12h", "12-16h", "16-20h", "20-24h"];

export function buildHeatmap(touchpoints: Touchpoint[]): { grid: number[][]; max: number; total: number } {
  const grid = HEATMAP_DAYS.map(() => new Array(6).fill(0) as number[]);
  let max = 0;
  let total = 0;
  for (const t of touchpoints) {
    // Cộng 7h để đọc "giờ treo tường" VN từ mốc UTC (deterministic, không lệ
    // thuộc timezone của server render).
    const vn = new Date(t.occurredAt.getTime() + 7 * 3_600_000);
    const dow = (vn.getUTCDay() + 6) % 7; // T2 = 0 … CN = 6
    const bucket = Math.floor(vn.getUTCHours() / 4);
    grid[dow][bucket]++;
    total++;
    if (grid[dow][bucket] > max) max = grid[dow][bucket];
  }
  return { grid, max, total };
}

/** Khung giờ khách hay tương tác nhất — câu tóm tắt cho heatmap. */
export function peakWindow(touchpoints: Touchpoint[]): string | null {
  const { grid, total } = buildHeatmap(touchpoints);
  if (total === 0) return null;
  let bestDay = 0;
  let bestBucket = 0;
  let best = -1;
  for (let d = 0; d < 7; d++) {
    for (let b = 0; b < 6; b++) {
      if (grid[d][b] > best) {
        best = grid[d][b];
        bestDay = d;
        bestBucket = b;
      }
    }
  }
  return `${HEATMAP_DAYS[bestDay]} khung ${HEATMAP_BUCKETS[bestBucket]}`;
}
