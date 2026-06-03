import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DateRangeFilter, parseRange } from "@/components/DateRangeFilter";
import {
  getKpisInRange,
  getTierDistribution,
  getSourceDistribution,
  getEventTypeDistribution,
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

  // Sequential to avoid overwhelming Supabase connection pool / Vercel memory
  const kpis = await safe(() => getKpisInRange(from, to), null);
  const tiers = await safe(() => getTierDistribution(), [] as Awaited<ReturnType<typeof getTierDistribution>>);
  const sources = await safe(() => getSourceDistribution(), [] as Awaited<ReturnType<typeof getSourceDistribution>>);
  const eventTypes = await safe(() => getEventTypeDistribution(), [] as Awaited<ReturnType<typeof getEventTypeDistribution>>);

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

        {/* TEMP: charts removed entirely. Display raw data to confirm queries work. */}
        <div className="mt-8 hairline rounded-2xl bg-white p-6">
          <h3 className="text-[15px] font-semibold mb-3">DEBUG: Tier data</h3>
          <pre className="text-[11px] overflow-x-auto bg-subtle p-3 rounded">
            {JSON.stringify(tiers, null, 2)}
          </pre>
        </div>
        <div className="mt-4 hairline rounded-2xl bg-white p-6">
          <h3 className="text-[15px] font-semibold mb-3">DEBUG: Source data</h3>
          <pre className="text-[11px] overflow-x-auto bg-subtle p-3 rounded">
            {JSON.stringify(sources, null, 2)}
          </pre>
        </div>
        <div className="mt-4 hairline rounded-2xl bg-white p-6">
          <h3 className="text-[15px] font-semibold mb-3">DEBUG: Event types data</h3>
          <pre className="text-[11px] overflow-x-auto bg-subtle p-3 rounded">
            {JSON.stringify(eventTypes, null, 2)}
          </pre>
        </div>
      </main>
    </>
  );
}
