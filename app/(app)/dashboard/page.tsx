import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DateRangeFilter, parseRange } from "@/components/DateRangeFilter";
import {
  getKpisInRange,
  getTierDistribution,
  getSourceDistribution,
  getEventTypeDistribution,
  getDailyActivity,
} from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function safe<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<{ data: T; error?: string }> {
  try {
    const data = await fn();
    return { data };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error(`[Dashboard ${name}]`, msg);
    return { data: fallback, error: `${name}: ${msg.slice(0, 250)}` };
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const { from, to, id: rangeId } = parseRange(params.range);

  const [kpisR, tiersR, sourcesR, eventTypesR, dailyR] = await Promise.all([
    safe("KPIs", () => getKpisInRange(from, to), null),
    safe("Tiers", () => getTierDistribution(), []),
    safe("Sources", () => getSourceDistribution(), []),
    safe("Events", () => getEventTypeDistribution(), []),
    safe("Daily", () => getDailyActivity(from, to), []),
  ]);

  const errors = [kpisR, tiersR, sourcesR, eventTypesR, dailyR]
    .filter((r) => r.error)
    .map((r) => r.error!);

  const kpis = kpisR.data;
  const tiers = tiersR.data;
  const sources = sourcesR.data;
  const eventTypes = eventTypesR.data;
  const daily = dailyR.data;

  // Dynamic imports for charts (recharts heavy; client-only)
  const { TierDonut } = await import("@/components/charts/TierDonut");
  const { SourceBar } = await import("@/components/charts/SourceBar");
  const { EventTypeBar } = await import("@/components/charts/EventTypeBar");
  const { DailyActivityArea } = await import("@/components/charts/DailyActivityArea");

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

        {errors.length > 0 && (
          <div className="mb-6 rounded-2xl bg-[#fff5f5] border border-[#fecaca] p-4">
            <div className="font-medium text-[13px] text-[#dc2626] mb-2">
              ⚠️ {errors.length} query lỗi (các phần khác vẫn hiển thị):
            </div>
            <ul className="space-y-1">
              {errors.map((e, i) => (
                <li key={i} className="text-[11px] font-mono text-[#991b1b] break-all">
                  · {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        {kpis && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KPICard label="🎓 Conversion" value={kpis.conversions.value} deltaPct={kpis.conversions.pct} deltaPositive={kpis.conversions.positive} deltaLabel="khoảng trước" />
            <KPICard label="🆕 Lead mới" value={kpis.newLeads.value} deltaPct={kpis.newLeads.pct} deltaPositive={kpis.newLeads.positive} deltaLabel="khoảng trước" />
            <KPICard label="💬 Đã tư vấn" value={kpis.engagedLeads.value} deltaPct={kpis.engagedLeads.pct} deltaPositive={kpis.engagedLeads.positive} deltaLabel="có chat/call" />
            <KPICard label="📈 Conv rate" value={kpis.conversionRate.value} unit="%" deltaLabel="conv / lead" />
          </div>
        )}

        {kpis && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KPICard label="📧 Email gửi" value={kpis.emailsSent.value} deltaPct={kpis.emailsSent.pct} deltaPositive={kpis.emailsSent.positive} />
            <KPICard label="👁 Email opens" value={kpis.emailOpens.value} deltaLabel="lần mở" />
            <KPICard label="📬 Open rate" value={kpis.openRate.value} unit="%" deltaLabel="opens/sent" />
            <KPICard label="↩ Response rate" value={kpis.responseRate.value} unit="%" deltaLabel="reply/chat" />
          </div>
        )}

        {daily.length > 0 && (
          <section className="mt-8 hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold">Hoạt động theo ngày</h3>
              <p className="mt-0.5 text-[12px] text-muted">Stack chat / email / conversion</p>
            </div>
            <DailyActivityArea data={daily} />
          </section>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {tiers.length > 0 && (
            <section className="hairline rounded-2xl bg-white p-6">
              <div className="mb-4">
                <h3 className="text-[15px] font-semibold">Phân bố Lead theo tier</h3>
              </div>
              <TierDonut data={tiers} />
            </section>
          )}
          {sources.length > 0 && (
            <section className="hairline rounded-2xl bg-white p-6">
              <div className="mb-4">
                <h3 className="text-[15px] font-semibold">Nguồn data</h3>
              </div>
              <SourceBar data={sources} metric="touchpoints" />
            </section>
          )}
        </div>

        {eventTypes.length > 0 && (
          <section className="mt-6 hairline rounded-2xl bg-white p-6">
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold">Loại event</h3>
            </div>
            <EventTypeBar data={eventTypes} />
          </section>
        )}
      </main>
    </>
  );
}
