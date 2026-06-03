import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { DateRangeFilter, parseRange } from "@/components/DateRangeFilter";
import { getKpisInRange, getTvvPerformance } from "@/lib/supabase/queries";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SalesDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const { from, to, id: rangeId } = parseRange(params.range);

  const [kpis, tvv] = await Promise.all([
    getKpisInRange(from, to),
    getTvvPerformance(),
  ]);

  return (
    <>
      <Topbar title="Sales / TVV" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Hiệu suất Sales</h1>
            <p className="mt-1 text-[12px] text-muted">
              Conversion · chat response · top TVV
            </p>
          </div>
          <DateRangeFilter value={rangeId} />
        </div>

        {/* Sales KPIs */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            label="🎓 Conversion"
            value={kpis.conversions.value}
            deltaPct={kpis.conversions.pct}
            deltaPositive={kpis.conversions.positive}
          />
          <KPICard
            label="💬 Lead chat đến"
            value={kpis.chatsReceived.value}
            deltaPct={kpis.chatsReceived.pct}
            deltaPositive={kpis.chatsReceived.positive}
          />
          <KPICard
            label="↩ TVV reply"
            value={kpis.tvvReplies.value}
            deltaLabel="trong kỳ"
          />
          <KPICard
            label="📈 Response rate"
            value={kpis.responseRate.value}
            unit="%"
            deltaLabel="TVV reply / chat đến"
          />
        </div>

        {/* TVV Performance table */}
        <section className="mt-8 hairline rounded-2xl bg-white">
          <div className="hairline-b px-6 py-4">
            <h3 className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
              <Users className="h-4 w-4" strokeWidth={1.75} /> Bảng xếp hạng TVV
            </h3>
            <p className="mt-0.5 text-[12px] text-muted">
              Theo số lead phụ trách · lifetime conversion rate
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-muted-2">
                <tr>
                  <th className="px-6 py-3 font-medium">#</th>
                  <th className="px-6 py-3 font-medium">TVV</th>
                  <th className="px-6 py-3 font-medium text-right">Lead phụ trách</th>
                  <th className="px-6 py-3 font-medium text-right">Conversion</th>
                  <th className="px-6 py-3 font-medium text-right">Reply chats</th>
                  <th className="px-6 py-3 font-medium text-right">Conversion rate</th>
                </tr>
              </thead>
              <tbody>
                {tvv.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-muted-2">
                      Chưa có TVV nào có data
                    </td>
                  </tr>
                ) : (
                  tvv.map((t, i) => (
                    <tr
                      key={t.name}
                      className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-subtle"
                    >
                      <td className="px-6 py-3 tabular-nums text-muted-2">{i + 1}</td>
                      <td className="px-6 py-3 font-medium">{t.name}</td>
                      <td className="px-6 py-3 text-right tabular-nums">
                        {t.leadCount.toLocaleString("vi-VN")}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums">
                        {t.converted.toLocaleString("vi-VN")}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums text-muted">
                        {t.replies.toLocaleString("vi-VN")}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums font-medium">
                        {t.conversionRate}%
                      </td>
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
