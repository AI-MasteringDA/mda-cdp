/**
 * Đánh giá "sức khỏe data" từ lịch sử snapshot — dùng chung cho cron (bắn Lark),
 * API và trang /health. Không phụ thuộc client DB nào, chỉ nhận mảng snapshot.
 */

export type Snapshot = {
  captured_at: string;
  source: string;
  touchpoints: number;
  leads: number;
  last_event_at: string | null;
};

export type Severity = "ok" | "warning" | "critical";

export type SourceHealth = {
  source: string;
  touchpoints: number;
  leads: number;
  peak7d: number;          // đỉnh touchpoints 7 ngày
  dropPct: number;         // % tụt so với đỉnh
  hoursSinceEvent: number | null;
  severity: Severity;
  issues: string[];
};

export type HealthReport = {
  overall: Severity;
  sources: SourceHealth[];
  generatedAt: string;
  hasSnapshots: boolean;
};

const REAL_SOURCES = ["smax", "salesforce", "instantly", "web"] as const;

// Ngưỡng
const DROP_CRITICAL = 0.30;   // tụt ≥30% so đỉnh 7 ngày = nghi mất data
const DROP_WARNING = 0.12;    // tụt ≥12% = cảnh báo nhẹ
// Bao lâu không có sự kiện mới thì coi là "ngưng cập nhật" (giờ). Wix chạy thưa.
const STALE_HOURS: Record<string, number> = {
  smax: 6, salesforce: 8, instantly: 8, web: 48,
};

const VN_LABEL: Record<string, string> = {
  smax: "SMAX (Zalo/FB)", salesforce: "Salesforce", instantly: "Instantly (email)", web: "Website/Wix",
};
export const sourceLabel = (s: string) => VN_LABEL[s] ?? s;

const worse = (a: Severity, b: Severity): Severity => {
  const rank = { ok: 0, warning: 1, critical: 2 };
  return rank[a] >= rank[b] ? a : b;
};

export function evaluateHealth(snapshots: Snapshot[], nowMs = Date.now()): HealthReport {
  const sevenDaysAgo = nowMs - 7 * 86400_000;
  const sources: SourceHealth[] = [];
  let overall: Severity = "ok";
  let hasAny = false;

  for (const src of REAL_SOURCES) {
    const rows = snapshots
      .filter((s) => s.source === src)
      .sort((a, b) => b.captured_at.localeCompare(a.captured_at)); // mới nhất trước
    if (rows.length === 0) continue;
    hasAny = true;

    const latest = rows[0];
    const recent = rows.filter((r) => Date.parse(r.captured_at) >= sevenDaysAgo);
    const peak7d = Math.max(latest.touchpoints, ...recent.map((r) => r.touchpoints));
    const dropPct = peak7d > 0 ? (peak7d - latest.touchpoints) / peak7d : 0;

    const hoursSinceEvent = latest.last_event_at
      ? (nowMs - Date.parse(latest.last_event_at)) / 3600_000
      : null;
    const staleLimit = STALE_HOURS[src] ?? 24;

    const issues: string[] = [];
    let severity: Severity = "ok";

    if (dropPct >= DROP_CRITICAL) {
      severity = "critical";
      issues.push(`Data tụt ${Math.round(dropPct * 100)}% so với đỉnh 7 ngày (${peak7d.toLocaleString("vi-VN")} → ${latest.touchpoints.toLocaleString("vi-VN")}) — nghi mất data`);
    } else if (dropPct >= DROP_WARNING) {
      severity = worse(severity, "warning");
      issues.push(`Data giảm nhẹ ${Math.round(dropPct * 100)}% so với đỉnh 7 ngày`);
    }

    if (hoursSinceEvent != null && hoursSinceEvent > staleLimit) {
      const sev: Severity = hoursSinceEvent > staleLimit * 3 ? "critical" : "warning";
      severity = worse(severity, sev);
      issues.push(`Không có sự kiện mới ${Math.round(hoursSinceEvent)} giờ (ngưỡng ${staleLimit}h) — cron có thể đang hỏng`);
    }

    overall = worse(overall, severity);
    sources.push({
      source: src,
      touchpoints: latest.touchpoints,
      leads: latest.leads,
      peak7d,
      dropPct,
      hoursSinceEvent,
      severity,
      issues,
    });
  }

  return {
    overall: hasAny ? overall : "ok",
    sources,
    generatedAt: new Date(nowMs).toISOString(),
    hasSnapshots: hasAny,
  };
}

/** Text gọn cho tin nhắn Lark. */
export function reportToLarkText(r: HealthReport): string {
  const icon = { ok: "✅", warning: "🟡", critical: "🔴" };
  const head =
    r.overall === "critical" ? "🔴 CẢNH BÁO DATA — nghi mất/hỏng"
    : r.overall === "warning" ? "🟡 Data có dấu hiệu bất thường"
    : "✅ Data khỏe";
  const lines = [head, ""];
  for (const s of r.sources) {
    lines.push(`${icon[s.severity]} ${sourceLabel(s.source)}: ${s.touchpoints.toLocaleString("vi-VN")} sự kiện · ${s.leads.toLocaleString("vi-VN")} lead`);
    for (const iss of s.issues) lines.push(`   ↳ ${iss}`);
  }
  lines.push("", `Giờ: ${new Date(r.generatedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`);
  return lines.join("\n");
}
