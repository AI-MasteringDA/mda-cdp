import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DateRangeFilter, parseRange } from "@/components/DateRangeFilter";
import { TierDonut } from "@/components/charts/TierDonut";
import { SourceBar } from "@/components/charts/SourceBar";
import { DailyActivityArea } from "@/components/charts/DailyActivityArea";
import { EventTypeBar } from "@/components/charts/EventTypeBar";
import {
  getKpisInRange,
  getDailyActivity,
  getTierDistribution,
  getSourceDistribution,
  getEventTypeDistribution,
} from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const { from, to, id: rangeId } = parseRange(params.range);

  const [kpis, daily, tiers, sources, eventTypes] = await Promise.all([
    getKpisInRange(from, to),
    getDailyActivity(from, to),
    getTierDistribution(),
    getSourceDistribution(),
    getEventTypeDistribution(),
  ]);

  return (
    <>
      <Topbar title="Tổng quan" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Tổng quan hoạt động</h1>
            <p className="mt-1 text-[12px] text-muted">
              Bộ chỉ số chính của workspace · so sánh với khoảng trước
            </p>
          </div>
          <DateRangeFilter value={rangeId} />
        </div>

        {/* KPI Row — 4 chính */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            label="🎓 Conversion"
            value={kpis.conversions.value}
            deltaPct={kpis.conversions.pct}
            deltaPositive={kpis.conversions.positive}
            deltaLabel="so với khoảng trước"
          />
          <KPICard
            label="🆕 Lead mới"
            value={kpis.newLeads.value}
            deltaPct={kpis.newLeads.pct}
            deltaPositive={kpis.newLeads.positive}
            deltaLabel="so với khoảng trước"
          />
          <KPICard
            label="💬 Lead đã tư vấn"
            value={kpis.engagedLeads.value}
            deltaPct={kpis.engagedLeads.pct}
            deltaPositive={kpis.engagedLeads.positive}
            deltaLabel="có chat/call trong kỳ"
          />
          <KPICard
            label="📈 Conversion rate"
            value={kpis.conversionRate.value}
            unit="%"
            deltaLabel="conversion / lead mới"
          />
        </div>

        {/* KPI Row 2 — engagement */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            label="📧 Email gửi đi"
            value={kpis.emailsSent.value}
            deltaPct={kpis.emailsSent.pct}
            deltaPositive={kpis.emailsSent.positive}
            deltaLabel="so với khoảng trước"
          />
          <KPICard
            label="👁 Email opens"
            value={kpis.emailOpens.value}
            deltaLabel="lần mở thành công"
          />
          <KPICard
            label="📬 Open rate"
            value={kpis.openRate.value}
            unit="%"
            deltaLabel="opens / sent"
          />
          <KPICard
            label="↩ Response rate"
            value={kpis.responseRate.value}
            unit="%"
            deltaLabel="TVV reply / chat đến"
          />
        </div>

        {/* Daily activity area */}
        <section className="mt-8 hairline rounded-2xl bg-white p-6">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold tracking-tight">
              Hoạt động theo ngày trong kỳ
            </h3>
            <p className="mt-0.5 text-[12px] text-muted">
              Stack chat / email / conversion
            </p>
          </div>
          <DailyActivityArea data={daily} />
        </section>

        {/* Tier + Source */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold tracking-tight">Phân bố Lead theo tier</h3>
              <p className="mt-0.5 text-[12px] text-muted">NÓNG / ẤM / MÁT / NGỦ ĐÔNG</p>
            </div>
            <TierDonut data={tiers} />
          </section>

          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold tracking-tight">Nguồn data</h3>
              <p className="mt-0.5 text-[12px] text-muted">Touchpoints theo source</p>
            </div>
            <SourceBar data={sources} metric="touchpoints" />
          </section>
        </div>

        {/* Event types */}
        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold tracking-tight">
              Hoạt động theo loại event
            </h3>
            <p className="mt-0.5 text-[12px] text-muted">
              Tổng số event mỗi loại trên toàn DB
            </p>
          </div>
          <EventTypeBar data={eventTypes} />
        </section>
      </main>
    </>
  );
}
