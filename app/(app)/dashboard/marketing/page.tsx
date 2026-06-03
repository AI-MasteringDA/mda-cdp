import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DateRangeFilter, parseRange } from "@/components/DateRangeFilter";
import { SourceBar } from "@/components/charts/SourceBar";
import {
  getKpisInRange,
  getSourceDistribution,
  getConversionBySource,
  getTopCampaigns,
} from "@/lib/supabase/queries";
import { Megaphone } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MarketingDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const { from, to, id: rangeId } = parseRange(params.range);

  const [kpis, sources, convBySource, campaigns] = await Promise.all([
    getKpisInRange(from, to),
    getSourceDistribution(),
    getConversionBySource(),
    getTopCampaigns(10),
  ]);

  return (
    <>
      <Topbar title="Marketing" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Marketing & Channels</h1>
            <p className="mt-1 text-[12px] text-muted">
              Hiệu suất từng nguồn data · campaign performance
            </p>
          </div>
          <DateRangeFilter value={rangeId} />
        </div>

        {/* Email KPIs */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            label="📧 Email gửi đi"
            value={kpis.emailsSent.value}
            deltaPct={kpis.emailsSent.pct}
            deltaPositive={kpis.emailsSent.positive}
          />
          <KPICard
            label="👁 Email opens"
            value={kpis.emailOpens.value}
            deltaLabel="trong kỳ"
          />
          <KPICard
            label="📬 Open rate"
            value={kpis.openRate.value}
            unit="%"
            deltaLabel="opens / sent"
          />
          <KPICard
            label="🆕 Lead mới"
            value={kpis.newLeads.value}
            deltaPct={kpis.newLeads.pct}
            deltaPositive={kpis.newLeads.positive}
          />
        </div>

        {/* Source dual view */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold tracking-tight">Touchpoints theo source</h3>
              <p className="mt-0.5 text-[12px] text-muted">Tổng số event mỗi nguồn</p>
            </div>
            <SourceBar data={sources} metric="touchpoints" />
          </section>

          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold tracking-tight">Lead theo source</h3>
              <p className="mt-0.5 text-[12px] text-muted">Tổng unique lead mỗi nguồn</p>
            </div>
            <SourceBar data={sources} metric="leads" />
          </section>
        </div>

        {/* Conversion rate by source */}
        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold tracking-tight">
              Source efficiency — conversion rate
            </h3>
            <p className="mt-0.5 text-[12px] text-muted">
              % lead chuyển đổi trong từng nguồn (lifetime)
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {convBySource.map((s) => (
              <div key={s.source} className="rounded-xl border border-[var(--border-subtle)] p-4">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  <span className="text-[12px] font-medium uppercase tracking-wider">
                    {s.source}
                  </span>
                </div>
                <div className="mt-3 text-[24px] font-semibold tabular-nums">
                  {s.rate}%
                </div>
                <div className="text-[11px] text-muted-2">
                  {s.converted}/{s.total.toLocaleString("vi-VN")} lead
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Top campaigns */}
        <section className="mt-6 hairline rounded-2xl bg-white">
          <div className="hairline-b px-6 py-4">
            <h3 className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
              <Megaphone className="h-4 w-4" strokeWidth={1.75} /> Top campaign theo volume
            </h3>
            <p className="mt-0.5 text-[12px] text-muted">
              Subject email được gửi nhiều nhất · số lead unique đã nhận
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-muted-2">
                <tr>
                  <th className="px-6 py-3 font-medium">#</th>
                  <th className="px-6 py-3 font-medium">Subject</th>
                  <th className="px-6 py-3 font-medium text-right">Sent</th>
                  <th className="px-6 py-3 font-medium text-right">Unique Leads</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-muted-2">
                      Chưa có campaign data
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c, i) => (
                    <tr key={c.subject} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="px-6 py-3 tabular-nums text-muted-2">{i + 1}</td>
                      <td className="px-6 py-3 max-w-xl truncate" title={c.subject}>
                        {c.subject}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums">{c.sent.toLocaleString("vi-VN")}</td>
                      <td className="px-6 py-3 text-right tabular-nums">{c.uniqueLeads.toLocaleString("vi-VN")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
