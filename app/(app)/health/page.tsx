import { Topbar } from "@/components/Topbar";
import { createClient } from "@/lib/supabase/server";
import { evaluateHealth, sourceLabel, type Snapshot, type Severity } from "@/lib/health-metrics";
import { HeartPulse, CheckCircle2, AlertTriangle, XCircle, TrendingDown, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

const SEV_UI: Record<Severity, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  ok:       { icon: CheckCircle2, color: "var(--success,#30a46c)", bg: "color-mix(in srgb, var(--success,#30a46c) 10%, transparent)", label: "Khỏe" },
  warning:  { icon: AlertTriangle, color: "var(--warm,#f5a623)",  bg: "color-mix(in srgb, var(--warm,#f5a623) 12%, transparent)",  label: "Cảnh báo" },
  critical: { icon: XCircle,       color: "var(--hot,#e5484d)",    bg: "color-mix(in srgb, var(--hot,#e5484d) 12%, transparent)",   label: "Nguy" },
};

export default async function HealthPage() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 8 * 86400_000).toISOString();
  const { data } = await supabase
    .from("data_health_snapshot")
    .select("captured_at, source, touchpoints, leads, last_event_at")
    .gte("captured_at", since)
    .order("captured_at", { ascending: false })
    .limit(2000);
  const snapshots = (data ?? []) as Snapshot[];
  const report = evaluateHealth(snapshots);
  const OverallIcon = SEV_UI[report.overall].icon;

  return (
    <>
      <Topbar title="Sức khỏe data" />
      <main className="mx-auto max-w-[1080px] px-8 py-8">
        <div className="mb-6 flex items-center gap-3">
          <HeartPulse className="h-6 w-6 text-muted" strokeWidth={1.75} />
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">Sức khỏe data</h1>
            <p className="text-[13px] text-muted">
              Giám sát 4 nguồn — phát hiện mất data / cron ngừng chạy. Cập nhật tự động, cũng bắn cảnh báo vào Lark.
            </p>
          </div>
        </div>

        {/* Trạng thái tổng */}
        <div
          className="mb-8 flex items-center gap-3 rounded-xl border px-5 py-4"
          style={{ background: SEV_UI[report.overall].bg, borderColor: SEV_UI[report.overall].color }}
        >
          <OverallIcon className="h-6 w-6" style={{ color: SEV_UI[report.overall].color }} strokeWidth={2} />
          <div>
            <div className="text-[16px] font-semibold" style={{ color: SEV_UI[report.overall].color }}>
              {report.overall === "critical" ? "Có nguồn data bất thường — cần kiểm tra ngay"
                : report.overall === "warning" ? "Có dấu hiệu bất thường nhẹ"
                : "Tất cả nguồn data đều khỏe"}
            </div>
            {!report.hasSnapshots && (
              <div className="text-[12.5px] text-muted">
                Chưa có snapshot nào — chạy health-check lần đầu (cron sẽ tự chạy, hoặc bấm chạy tay).
              </div>
            )}
          </div>
        </div>

        {/* Từng nguồn */}
        <div className="grid gap-4 sm:grid-cols-2">
          {report.sources.map((s) => {
            const ui = SEV_UI[s.severity];
            const Icon = ui.icon;
            return (
              <div key={s.source} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--background)] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-semibold">{sourceLabel(s.source)}</div>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
                    style={{ background: ui.bg, color: ui.color }}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                    {ui.label}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-[13px]">
                  <div>
                    <div className="text-muted">Sự kiện</div>
                    <div className="text-[20px] font-bold tabular-nums">{s.touchpoints.toLocaleString("vi-VN")}</div>
                    <div className="text-[11px] text-muted-2">đỉnh 7 ngày: {s.peak7d.toLocaleString("vi-VN")}</div>
                  </div>
                  <div>
                    <div className="text-muted">Lead</div>
                    <div className="text-[20px] font-bold tabular-nums">{s.leads.toLocaleString("vi-VN")}</div>
                    <div className="text-[11px] text-muted-2">
                      {s.hoursSinceEvent != null ? `mới ${Math.round(s.hoursSinceEvent)}h trước` : "—"}
                    </div>
                  </div>
                </div>
                {s.issues.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
                    {s.issues.map((iss) => (
                      <li key={iss} className="flex items-start gap-2 text-[12.5px]" style={{ color: ui.color }}>
                        {iss.includes("tụt") || iss.includes("giảm")
                          ? <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                          : <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                        {iss}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-[12px] text-muted-2">
          Cách hoạt động: mỗi vài giờ hệ thống đo số sự kiện/lead của từng nguồn và so với đỉnh 7 ngày. Tụt ≥30% → báo đỏ (nghi mất data);
          nguồn ngừng có sự kiện mới quá lâu → báo cron hỏng. Cảnh báo cũng gửi vào group Lark.
        </p>
      </main>
    </>
  );
}
