import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { LeadListItem } from "@/components/LeadListItem";
import { Avatar } from "@/components/ui/Avatar";
import { TierDonut } from "@/components/charts/TierDonut";
import { SourceBar } from "@/components/charts/SourceBar";
import { ConversionLine } from "@/components/charts/ConversionLine";
import { EventTypeBar } from "@/components/charts/EventTypeBar";
import {
  getDashboardKPI,
  getHotLeads,
  getRecentActivities,
  getTierDistribution,
  getSourceDistribution,
  getConversionTrend,
  getEventTypeDistribution,
} from "@/lib/supabase/queries";
import { formatRelativeVi } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [kpi, hotLeads, activities, tiers, sources, conversionTrend, eventTypes] = await Promise.all([
    getDashboardKPI(),
    getHotLeads(8),
    getRecentActivities(10),
    getTierDistribution(),
    getSourceDistribution(),
    getConversionTrend(),
    getEventTypeDistribution(),
  ]);

  return (
    <>
      <Topbar title="Tổng quan" />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        {/* KPI Row — 4 real metrics */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            label="🔥 Lead NÓNG"
            value={kpi.hotToday.value}
            deltaLabel="cần gọi NGAY"
          />
          <KPICard
            label="🎓 Conversion tuần này"
            value={kpi.conversionsWeek.value}
            deltaPct={kpi.conversionsWeek.deltaPct}
            deltaPositive={kpi.conversionsWeek.deltaPositive}
            deltaLabel="so với tuần trước"
          />
          <KPICard
            label="💬 Lead đã tư vấn (7d)"
            value={kpi.consultedWeek.value}
            deltaPct={kpi.consultedWeek.deltaPct}
            deltaPositive={kpi.consultedWeek.deltaPositive}
            deltaLabel="so với tuần trước"
          />
          <KPICard
            label="📈 Conversion rate"
            value={kpi.conversionRate.value}
            unit="%"
            deltaLabel={`${kpi.extras.totalConv}/${kpi.extras.totalLeads.toLocaleString("vi-VN")} cumulative`}
          />
        </div>

        {/* Charts row 1: Tier + Source */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight">Phân bố Lead theo tier</h3>
                <p className="mt-0.5 text-[12px] text-muted">NÓNG / ẤM / MÁT / NGỦ ĐÔNG</p>
              </div>
            </div>
            <TierDonut data={tiers} />
          </section>

          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight">Nguồn data</h3>
                <p className="mt-0.5 text-[12px] text-muted">Touchpoints theo source</p>
              </div>
            </div>
            <SourceBar data={sources} metric="touchpoints" />
          </section>
        </div>

        {/* Charts row 2: Trend (full width) */}
        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight">
                Conversion vs Lead mới — 12 tuần qua
              </h3>
              <p className="mt-0.5 text-[12px] text-muted">
                Tổng conversion (xanh) so với tổng lead tạo mới (xám)
              </p>
            </div>
          </div>
          <ConversionLine data={conversionTrend} />
        </section>

        {/* Charts row 3: Event types */}
        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight">
                Hoạt động theo loại event
              </h3>
              <p className="mt-0.5 text-[12px] text-muted">
                Tổng số event mỗi loại trên toàn DB
              </p>
            </div>
          </div>
          <EventTypeBar data={eventTypes} />
        </section>

        {/* Hot leads + Recent activity */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="hairline rounded-2xl bg-white lg:col-span-3">
            <div className="hairline-b flex items-center justify-between px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight">
                  🔥 Top Lead NÓNG — gọi NGAY
                </h3>
                <p className="mt-0.5 text-[12px] text-muted">
                  Sắp xếp theo điểm giảm dần
                </p>
              </div>
              <Link
                href="/hot-leads"
                className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-foreground"
              >
                Xem tất cả
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
            </div>
            <div className="px-3 py-2">
              {hotLeads.length === 0 ? (
                <EmptyState message="Chưa có lead NÓNG (điểm ≥ 70)." />
              ) : (
                hotLeads.map((lead) => <LeadListItem key={lead.id} lead={lead} />)
              )}
            </div>
          </section>

          <section className="hairline rounded-2xl bg-white lg:col-span-2">
            <div className="hairline-b px-6 py-4">
              <h3 className="text-[15px] font-semibold tracking-tight">
                Hoạt động gần đây
              </h3>
              <p className="mt-0.5 text-[12px] text-muted">
                Realtime · 10 events mới nhất
              </p>
            </div>
            <div className="px-3 py-2">
              {activities.length === 0 ? (
                <EmptyState message="Chưa có hoạt động nào." />
              ) : (
                activities.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-subtle"
                  >
                    <Avatar name={a.lead} color={a.avatarColor} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px]">
                        <span className="font-medium">{a.lead}</span>{" "}
                        <span className="text-muted">{a.action}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-2">
                        {formatRelativeVi(a.at)} · {a.source}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-6 py-8 text-center text-[13px] text-muted-2">
      {message}
    </div>
  );
}
