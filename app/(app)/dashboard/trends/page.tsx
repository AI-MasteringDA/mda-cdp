import { Topbar } from "@/components/Topbar";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DateRangeFilter, parseRange } from "@/components/DateRangeFilter";
import { DailyActivityArea } from "@/components/charts/DailyActivityArea";
import { ConversionLine } from "@/components/charts/ConversionLine";
import { KPICard } from "@/components/KPICard";
import {
  getKpisInRange,
  getDailyActivity,
  getConversionTrend,
} from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function TrendsDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const { from, to, id: rangeId } = parseRange(params.range);

  const [kpis, daily, conversionTrend] = await Promise.all([
    getKpisInRange(from, to),
    getDailyActivity(from, to),
    getConversionTrend(),
  ]);

  return (
    <>
      <Topbar title="Trends & Cohort" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Trends theo thời gian</h1>
            <p className="mt-1 text-[12px] text-muted">
              Daily activity · 12-week conversion trend · cohort behavior
            </p>
          </div>
          <DateRangeFilter value={rangeId} />
        </div>

        {/* KPIs trend */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            label="🆕 Lead mới"
            value={kpis.newLeads.value}
            deltaPct={kpis.newLeads.pct}
            deltaPositive={kpis.newLeads.positive}
          />
          <KPICard
            label="🎓 Conversion"
            value={kpis.conversions.value}
            deltaPct={kpis.conversions.pct}
            deltaPositive={kpis.conversions.positive}
          />
          <KPICard
            label="📈 Conv rate"
            value={kpis.conversionRate.value}
            unit="%"
            deltaLabel="conv / lead mới"
          />
          <KPICard
            label="💬 Engaged"
            value={kpis.engagedLeads.value}
            deltaPct={kpis.engagedLeads.pct}
            deltaPositive={kpis.engagedLeads.positive}
          />
        </div>

        {/* 12-week conversion line */}
        <section className="mt-8 hairline rounded-2xl bg-white p-6">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold tracking-tight">
              Conversion vs Lead mới — 12 tuần qua
            </h3>
            <p className="mt-0.5 text-[12px] text-muted">
              Conversion (xanh) so với Lead tạo mới (xám)
            </p>
          </div>
          <ConversionLine data={conversionTrend} />
        </section>

        {/* Daily activity */}
        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold tracking-tight">
              Hoạt động theo ngày trong kỳ
            </h3>
            <p className="mt-0.5 text-[12px] text-muted">
              Stack chat / email / conversion theo từng ngày
            </p>
          </div>
          <DailyActivityArea data={daily} />
        </section>
      </main>
    </>
  );
}
