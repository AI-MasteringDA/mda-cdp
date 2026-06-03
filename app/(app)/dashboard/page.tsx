import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DateRangeFilter, parseRange } from "@/components/DateRangeFilter";
import { Suspense } from "react";
import {
  getKpisInRange,
  getTierDistribution,
  getSourceDistribution,
  getEventTypeDistribution,
  getDailyActivity,
} from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function KpisSection({ from, to }: { from: Date; to: Date }) {
  let kpis;
  try {
    kpis = await getKpisInRange(from, to);
  } catch (e) {
    return (
      <div className="rounded-2xl bg-[#fff5f5] p-6 text-[13px] text-[#dc2626]">
        Lỗi tải KPI: {(e as Error).message.slice(0, 200)}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard label="🎓 Conversion" value={kpis.conversions.value} deltaPct={kpis.conversions.pct} deltaPositive={kpis.conversions.positive} deltaLabel="so với khoảng trước" />
        <KPICard label="🆕 Lead mới" value={kpis.newLeads.value} deltaPct={kpis.newLeads.pct} deltaPositive={kpis.newLeads.positive} deltaLabel="so với khoảng trước" />
        <KPICard label="💬 Đã tư vấn" value={kpis.engagedLeads.value} deltaPct={kpis.engagedLeads.pct} deltaPositive={kpis.engagedLeads.positive} deltaLabel="có chat/call" />
        <KPICard label="📈 Conv rate" value={kpis.conversionRate.value} unit="%" deltaLabel="conv / lead mới" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard label="📧 Email gửi" value={kpis.emailsSent.value} deltaPct={kpis.emailsSent.pct} deltaPositive={kpis.emailsSent.positive} />
        <KPICard label="👁 Email opens" value={kpis.emailOpens.value} deltaLabel="lần mở" />
        <KPICard label="📬 Open rate" value={kpis.openRate.value} unit="%" deltaLabel="opens / sent" />
        <KPICard label="↩ Response rate" value={kpis.responseRate.value} unit="%" deltaLabel="reply / chat" />
      </div>
    </>
  );
}

async function ChartsSection({ from, to }: { from: Date; to: Date }) {
  const [tiers, sources, eventTypes, daily] = await Promise.all([
    getTierDistribution().catch(() => []),
    getSourceDistribution().catch(() => []),
    getEventTypeDistribution().catch(() => []),
    getDailyActivity(from, to).catch(() => []),
  ]);

  // Lazy load chart components only when data is available
  const { TierDonut } = await import("@/components/charts/TierDonut");
  const { SourceBar } = await import("@/components/charts/SourceBar");
  const { EventTypeBar } = await import("@/components/charts/EventTypeBar");
  const { DailyActivityArea } = await import("@/components/charts/DailyActivityArea");

  return (
    <>
      {daily.length > 0 && (
        <section className="mt-8 hairline rounded-2xl bg-white p-6">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold tracking-tight">Hoạt động theo ngày</h3>
            <p className="mt-0.5 text-[12px] text-muted">Stack chat / email / conversion</p>
          </div>
          <DailyActivityArea data={daily} />
        </section>
      )}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {tiers.length > 0 && (
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold tracking-tight">Phân bố Lead theo tier</h3>
              <p className="mt-0.5 text-[12px] text-muted">NÓNG / ẤM / MÁT / NGỦ ĐÔNG</p>
            </div>
            <TierDonut data={tiers} />
          </section>
        )}
        {sources.length > 0 && (
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold tracking-tight">Nguồn data</h3>
              <p className="mt-0.5 text-[12px] text-muted">Touchpoints theo source</p>
            </div>
            <SourceBar data={sources} metric="touchpoints" />
          </section>
        )}
      </div>
      {eventTypes.length > 0 && (
        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold tracking-tight">Loại event</h3>
            <p className="mt-0.5 text-[12px] text-muted">Tổng số event mỗi loại</p>
          </div>
          <EventTypeBar data={eventTypes} />
        </section>
      )}
    </>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const { from, to, id: rangeId } = parseRange(params.range);

  return (
    <>
      <Topbar title="Tổng quan" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Tổng quan hoạt động</h1>
            <p className="mt-1 text-[12px] text-muted">Bộ chỉ số chính · so sánh với khoảng trước</p>
          </div>
          <DateRangeFilter value={rangeId} />
        </div>

        <Suspense fallback={<KpiSkeleton />}>
          <KpisSection from={from} to={to} />
        </Suspense>

        <Suspense fallback={<ChartSkeleton />}>
          <ChartsSection from={from} to={to} />
        </Suspense>
      </main>
    </>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="hairline h-[120px] rounded-2xl bg-white animate-pulse" />
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="mt-8 hairline h-[320px] rounded-2xl bg-white animate-pulse" />
  );
}
