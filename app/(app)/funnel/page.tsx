import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { FunnelBar } from "@/components/charts/FunnelBar";
import { SimpleBar } from "@/components/charts/SimpleBar";
import { CohortBySourceMatrix } from "@/components/CohortBySourceMatrix";
import { MetricDefinitionBadge } from "@/components/MetricDefinitionBadge";
import { CONVERSION_RATE, ENROLLED_STUDENT } from "@/lib/metrics-config";
import {
  getConversionFunnel,
  getStageDistribution,
  getCohortByMonth,
  getCohortBySourceMonth,
  getAllLeadsCount,
} from "@/lib/supabase/queries";
import { GitBranch, TrendingDown } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FunnelPage() {
  const [funnel, stages, cohorts, totalLeads, cohortBySource] = await Promise.all([
    getConversionFunnel(),
    getStageDistribution(),
    getCohortByMonth(),
    getAllLeadsCount(),
    getCohortBySourceMonth(),
  ]);

  // Funnel drop analysis
  const drops: { from: string; to: string; lost: number; pct: number }[] = [];
  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1];
    const curr = funnel[i];
    const lost = prev.count - curr.count;
    const pct = prev.count > 0 ? (lost / prev.count * 100) : 0;
    drops.push({ from: prev.stage, to: curr.stage, lost, pct });
  }
  const biggestDrop = [...drops].sort((a, b) => b.pct - a.pct)[0];

  const stageBar = stages.map((s) => ({
    label: s.stage,
    value: s.count,
    color: s.color,
  }));

  // Cohort table data
  const cohortRows = cohorts.map((c) => ({
    month: c.month,
    total: c.total,
    engaged: c.engaged,
    converted: c.converted,
    engagementRate: c.engagementRate,
    conversionRate: c.conversionRate,
  }));

  const lastCohort = cohorts[cohorts.length - 1];
  const totalEngaged = funnel.find((f) => f.stage.includes("engage"))?.count ?? 0;
  const totalConverted = funnel[funnel.length - 1]?.count ?? 0;
  const finalConvRate = totalLeads > 0 ? (totalConverted / totalLeads * 100) : 0;

  return (
    <>
      <Topbar title="Phễu & Cohort" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Phễu chuyển đổi & Cohort
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Bao nhiêu lead drop ở mỗi bước? Cohort tháng nào chuyển đổi tốt nhất?
          </p>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <KPICard label="Tổng lead vào phễu" value={totalLeads.toLocaleString("vi-VN")} />
          <KPICard label="Đã engage" value={totalEngaged.toLocaleString("vi-VN")} />
          <KPICard label="Đã chốt 🎓" value={totalConverted.toLocaleString("vi-VN")} />
          <KPICard label="Final conversion rate" value={`${finalConvRate.toFixed(2)}%`} />
        </div>

        {/* Funnel chart */}
        <section className="hairline rounded-2xl bg-white mb-6">
          <div className="hairline-b px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Phễu 5 bước</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Tổng lead → Engage → Email → Chat → Chốt. Drop-rate hiển thị bên phải mỗi bước.
              </p>
            </div>
            <GitBranch className="h-5 w-5 text-muted-2" strokeWidth={1.75} />
          </div>
          <div className="p-6">
            <FunnelBar data={funnel} />
          </div>
        </section>

        {/* Biggest drop alert */}
        {biggestDrop && biggestDrop.lost > 0 && (
          <section className="hairline rounded-2xl bg-[#fef2f2] p-5 mb-6">
            <div className="flex items-start gap-3">
              <TrendingDown className="mt-0.5 h-5 w-5 text-[var(--hot)]" strokeWidth={1.75} />
              <div className="flex-1">
                <h3 className="text-[14px] font-semibold">
                  🔥 Bottleneck lớn nhất: {biggestDrop.from} → {biggestDrop.to}
                </h3>
                <p className="mt-1 text-[13px] text-muted">
                  Mất <strong>{biggestDrop.lost.toLocaleString("vi-VN")}</strong> lead
                  {" "}({biggestDrop.pct.toFixed(1)}% drop). Đây là nơi cần ưu tiên tối ưu nhất.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Stage distribution */}
        <section className="hairline rounded-2xl bg-white mb-6">
          <div className="hairline-b px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">Phân bổ stage (Salesforce)</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Hiện tại các lead đang ở stage nào? Stage càng phía cuối càng gần chốt.
            </p>
          </div>
          <div className="p-6">
            {stageBar.every((s) => s.value === 0) ? (
              <div className="py-12 text-center text-[13px] text-muted-2">
                Chưa có stage data — cần đồng bộ SF.
              </div>
            ) : (
              <SimpleBar data={stageBar} valueLabel="lead" />
            )}
          </div>
        </section>

        {/* Cohort × Source heatmap */}
        <section className="hairline rounded-2xl bg-white mb-6">
          <div className="hairline-b px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight flex items-center gap-1.5">
              Cohort × Source (heatmap conversion rate)
              <MetricDefinitionBadge def={CONVERSION_RATE} />
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Tỷ lệ chuyển đổi theo source × tháng nhập. Ô càng xanh = chốt càng tốt.
              Phát hiện kênh nào hiệu quả theo từng giai đoạn.
            </p>
          </div>
          <CohortBySourceMatrix data={cohortBySource} />
        </section>

        {/* Cohort table */}
        <section className="hairline rounded-2xl bg-white">
          <div className="hairline-b px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight flex items-center gap-1.5">
              Cohort theo tháng nhập lead
              <MetricDefinitionBadge def={ENROLLED_STUDENT} />
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Lead nhập tháng nào engage / chốt tốt nhất? Cohort gần đây có thể còn động.
            </p>
          </div>
          <div className="p-3">
            {cohortRows.length === 0 ? (
              <div className="py-12 text-center text-[13px] text-muted-2">
                Chưa đủ data cho cohort analysis.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
                      <th className="text-left px-4 py-2">Tháng</th>
                      <th className="text-right px-4 py-2">Lead</th>
                      <th className="text-right px-4 py-2">Engaged</th>
                      <th className="text-right px-4 py-2">Engage %</th>
                      <th className="text-right px-4 py-2">Converted</th>
                      <th className="text-right px-4 py-2">Conv %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohortRows.map((c) => (
                      <tr key={c.month} className="border-t border-[var(--border-subtle)] hover:bg-subtle">
                        <td className="px-4 py-2.5 font-mono">{c.month}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.total.toLocaleString("vi-VN")}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.engaged.toLocaleString("vi-VN")}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <ProgressPill value={c.engagementRate} max={100} color="#5ac8fa" />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.converted.toLocaleString("vi-VN")}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <ProgressPill value={c.conversionRate} max={Math.max(...cohorts.map((x) => x.conversionRate), 1)} color="#22c55e" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {lastCohort && (
              <div className="px-6 py-3 text-[11px] text-muted-2 border-t border-[var(--border-subtle)]">
                * Cohort {lastCohort.month} có thể chưa kết thúc — conversion sẽ còn tăng theo thời gian.
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}

function ProgressPill({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="inline-flex items-center gap-2 min-w-[80px] justify-end">
      <span className="tabular-nums">{value.toFixed(1)}%</span>
      <div className="h-1.5 w-12 rounded bg-subtle overflow-hidden">
        <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
