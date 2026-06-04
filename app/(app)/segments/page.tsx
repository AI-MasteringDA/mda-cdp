import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { TierDonut } from "@/components/charts/TierDonut";
import { SimpleBar } from "@/components/charts/SimpleBar";
import { OutlierSegmentsCard } from "@/components/OutlierSegmentsCard";
import { MetricDefinitionBadge } from "@/components/MetricDefinitionBadge";
import { ENROLLED_STUDENT } from "@/lib/metrics-config";
import {
  getTierDistribution,
  getSourceTierMatrix,
  getEngagementSegments,
  getAllLeadsCount,
  getOutlierSegments,
} from "@/lib/supabase/queries";
import { PieChart, Layers } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TIER_COLOR: Record<string, string> = {
  "NÓNG": "#ff3b30",
  "ẤM": "#ff9500",
  "MÁT": "#5ac8fa",
  "NGỦ ĐÔNG": "#3a3a3c",
};

const TIER_HREF: Record<string, string> = {
  "NÓNG": "/hot-leads",
  "ẤM": "/warm-leads",
  "MÁT": "/cool-leads",
  "NGỦ ĐÔNG": "/dormant-leads",
};

const SOURCE_LABEL: Record<string, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  web: "Website",
};

export default async function SegmentsPage() {
  const [tiers, sourceTier, engagement, totalLeads, outliers] = await Promise.all([
    getTierDistribution(),
    getSourceTierMatrix(),
    getEngagementSegments(),
    getAllLeadsCount(),
    getOutlierSegments(),
  ]);

  const hotPct = totalLeads ? (tiers.find((t) => t.name === "NÓNG")?.value ?? 0) / totalLeads * 100 : 0;
  const dormantPct = totalLeads ? (tiers.find((t) => t.name === "NGỦ ĐÔNG")?.value ?? 0) / totalLeads * 100 : 0;
  const hot = tiers.find((t) => t.name === "NÓNG")?.value ?? 0;
  const warm = tiers.find((t) => t.name === "ẤM")?.value ?? 0;

  // Engagement bar
  const engagementBar = engagement.map((e) => ({
    label: e.label,
    value: e.count,
    color: e.color,
  }));

  return (
    <>
      <Topbar title="Phân khúc giá trị" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Phân khúc lead
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Chia lead theo tier (NÓNG/ẤM/MÁT/NGỦ ĐÔNG), nguồn data, mức engagement
            — để targeting đúng nhóm thay vì spray-and-pray.
          </p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <KPICard label="Tổng lead" value={totalLeads.toLocaleString("vi-VN")} />
          <KPICard label="Lead NÓNG" value={`${hot.toLocaleString("vi-VN")} (${hotPct.toFixed(1)}%)`} />
          <KPICard label="Lead ẤM" value={warm.toLocaleString("vi-VN")} />
          <KPICard label="NGỦ ĐÔNG" value={`${dormantPct.toFixed(1)}%`} />
        </div>

        {/* Tier donut */}
        <section className="hairline rounded-2xl bg-white mb-6">
          <div className="hairline-b px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Phân bổ theo tier</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Click vào tier để xem danh sách lead trong tier đó.
              </p>
            </div>
            <PieChart className="h-5 w-5 text-muted-2" strokeWidth={1.75} />
          </div>
          <div className="p-6">
            <TierDonut data={tiers} />
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
              {tiers.map((t) => (
                <Link
                  key={t.name}
                  href={TIER_HREF[t.name] || "/leads"}
                  className="hairline press rounded-lg p-3 hover:bg-subtle transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-sm" style={{ background: t.color }} />
                    <span className="text-[11px] uppercase tracking-wider font-medium">{t.name}</span>
                  </div>
                  <div className="mt-1 text-[18px] font-semibold tabular-nums">
                    {t.value.toLocaleString("vi-VN")}
                  </div>
                  <div className="text-[10px] text-muted-2">
                    Xem danh sách →
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Source × Tier matrix */}
        <section className="hairline rounded-2xl bg-white mb-6">
          <div className="hairline-b px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Ma trận: Nguồn × Tier</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Nguồn nào sinh nhiều lead NÓNG nhất? Nguồn nào toàn NGỦ ĐÔNG?
              </p>
            </div>
            <Layers className="h-5 w-5 text-muted-2" strokeWidth={1.75} />
          </div>
          <div className="p-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
                  <th className="text-left px-4 py-2">Nguồn</th>
                  {sourceTier.tiers.map((t) => (
                    <th key={t} className="text-right px-4 py-2">
                      <span
                        className="inline-flex items-center gap-1.5"
                      >
                        <span className="h-2 w-2 rounded-sm" style={{ background: TIER_COLOR[t] }} />
                        {t}
                      </span>
                    </th>
                  ))}
                  <th className="text-right px-4 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {sourceTier.sources.map((s) => {
                  const row = sourceTier.matrix[s];
                  const total = Object.values(row).reduce((a, b) => a + b, 0);
                  if (total === 0) return null;
                  return (
                    <tr key={s} className="border-t border-[var(--border-subtle)] hover:bg-subtle">
                      <td className="px-4 py-2.5 font-medium">
                        {SOURCE_LABEL[s] || s}
                      </td>
                      {sourceTier.tiers.map((t) => {
                        const v = row[t] ?? 0;
                        const pct = total ? (v / total * 100) : 0;
                        return (
                          <td key={t} className="px-4 py-2.5 text-right tabular-nums">
                            <span className="font-medium">{v.toLocaleString("vi-VN")}</span>
                            {v > 0 && (
                              <span className="ml-1 text-[11px] text-muted-2">
                                ({pct.toFixed(1)}%)
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                        {total.toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* OUTLIER segments — high-value patterns for lookalike */}
        <div className="mb-6">
          <OutlierSegmentsCard data={outliers} />
        </div>

        {/* Engagement segments */}
        <section className="hairline rounded-2xl bg-white">
          <div className="hairline-b px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight flex items-center gap-1.5">
              Phân khúc theo mức Engagement
              <MetricDefinitionBadge def={ENROLLED_STUDENT} />
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Bucket theo số touchpoint mỗi lead. Lurker = chỉ mới có 1 touch (lead_created),
              Power = đã chat/email ≥15 lần.
            </p>
          </div>
          <div className="p-6">
            <SimpleBar data={engagementBar} valueLabel="lead" />
          </div>
        </section>
      </main>
    </>
  );
}
