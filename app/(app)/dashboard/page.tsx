import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DateRangeFilter, parseRange } from "@/components/DateRangeFilter";
import { DashboardCharts } from "@/components/DashboardCharts";
import {
  getKpisInRange,
  getTierDistribution,
  getSourceDistribution,
  getEventTypeDistribution,
  getDailyActivity,
} from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const { from, to, id: rangeId } = parseRange(params.range);

  const [kpis, tiers, sources, eventTypes] = await Promise.all([
    safe(() => getKpisInRange(from, to), null),
    safe(() => getTierDistribution(), [] as Awaited<ReturnType<typeof getTierDistribution>>),
    safe(() => getSourceDistribution(), [] as Awaited<ReturnType<typeof getSourceDistribution>>),
    safe(() => getEventTypeDistribution(), [] as Awaited<ReturnType<typeof getEventTypeDistribution>>),
  ]);
  // getDailyActivity removed temporarily — too many parallel queries was crashing
  const daily: Awaited<ReturnType<typeof getDailyActivity>> = [];

  return (
    <>
      <Topbar title="Tổng quan" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Tổng quan</h1>
            <p className="mt-1 text-[12px] text-muted">So sánh với khoảng trước</p>
          </div>
          <DateRangeFilter value={rangeId} />
        </div>

        {kpis && (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <KPICard label="🎓 Conversion" value={kpis.conversions.value} deltaPct={kpis.conversions.pct} deltaPositive={kpis.conversions.positive} deltaLabel="khoảng trước" />
              <KPICard label="🆕 Lead mới" value={kpis.newLeads.value} deltaPct={kpis.newLeads.pct} deltaPositive={kpis.newLeads.positive} deltaLabel="khoảng trước" />
              <KPICard label="💬 Đã tư vấn" value={kpis.engagedLeads.value} deltaPct={kpis.engagedLeads.pct} deltaPositive={kpis.engagedLeads.positive} deltaLabel="có chat/call" />
              <KPICard label="📈 Conv rate" value={kpis.conversionRate.value} unit="%" deltaLabel="conv / lead" />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <KPICard label="📧 Email gửi" value={kpis.emailsSent.value} deltaPct={kpis.emailsSent.pct} deltaPositive={kpis.emailsSent.positive} />
              <KPICard label="👁 Email opens" value={kpis.emailOpens.value} deltaLabel="lần mở" />
              <KPICard label="📬 Open rate" value={kpis.openRate.value} unit="%" deltaLabel="opens/sent" />
              <KPICard label="↩ Response rate" value={kpis.responseRate.value} unit="%" deltaLabel="reply/chat" />
            </div>
          </>
        )}

        <DashboardCharts
          tiers={tiers}
          sources={sources}
          eventTypes={eventTypes}
          daily={daily}
        />
      </main>
    </>
  );
}
