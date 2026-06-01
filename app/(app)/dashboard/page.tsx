import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { LeadListItem } from "@/components/LeadListItem";
import { Avatar } from "@/components/ui/Avatar";
import {
  getDashboardKPI,
  getHotLeads,
  getColdLeads,
  getRecentActivities,
} from "@/lib/supabase/queries";
import { formatRelativeVi } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [kpi, hotLeads, coldLeads, activities] = await Promise.all([
    getDashboardKPI(),
    getHotLeads(10),
    getColdLeads(10),
    getRecentActivities(8),
  ]);

  return (
    <>
      <Topbar title="Tổng quan" />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            label="Lead nóng hôm nay"
            value={kpi.hotToday.value}
            deltaPct={kpi.hotToday.deltaPct}
            deltaPositive={kpi.hotToday.deltaPositive}
          />
          <KPICard
            label="Lead nguội cần cứu"
            value={kpi.coldToRescue.value}
            deltaPct={kpi.coldToRescue.deltaPct}
            deltaPositive={kpi.coldToRescue.deltaPositive}
          />
          <KPICard
            label="Đã tư vấn tuần này"
            value={kpi.consultedWeek.value}
            deltaPct={kpi.consultedWeek.deltaPct}
            deltaPositive={kpi.consultedWeek.deltaPositive}
          />
          <KPICard
            label="Tỷ lệ chuyển đổi"
            value={kpi.conversionRate.value}
            unit="%"
            deltaPct={kpi.conversionRate.deltaPct}
            deltaPositive={kpi.conversionRate.deltaPositive}
          />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="hairline rounded-2xl bg-white lg:col-span-3">
            <div className="hairline-b flex items-center justify-between px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight">
                  Lead nóng — nên gọi trước
                </h3>
                <p className="mt-0.5 text-[12px] text-muted">
                  Đọc từ Supabase · cập nhật mỗi lần ETL chạy
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
                <EmptyState message="Chưa có lead nóng (hot_score >= 70). Cần thêm rule hoặc touchpoint." />
              ) : (
                hotLeads.map((lead) => (
                  <LeadListItem key={lead.id} lead={lead} variant="hot" />
                ))
              )}
            </div>
          </section>

          <section className="hairline rounded-2xl bg-white lg:col-span-2">
            <div className="hairline-b px-6 py-4">
              <h3 className="text-[15px] font-semibold tracking-tight">
                Hoạt động gần đây
              </h3>
              <p className="mt-0.5 text-[12px] text-muted">
                Đọc từ <code className="font-mono">fact_touchpoint</code> · realtime
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

        <section className="mt-8 hairline rounded-2xl bg-white">
          <div className="hairline-b flex items-center justify-between px-6 py-4">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight">
                Lead nguội — cần cứu
              </h3>
              <p className="mt-0.5 text-[12px] text-muted">
                Lead có nguy cơ rời phễu nếu không liên hệ trong 48h
              </p>
            </div>
            <Link
              href="/cold-leads"
              className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-foreground"
            >
              Xem tất cả
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          </div>
          <div className="px-3 py-2">
            {coldLeads.length === 0 ? (
              <EmptyState message="Chưa có lead nguội (cold_score >= 70)." />
            ) : (
              coldLeads.map((lead) => (
                <LeadListItem key={lead.id} lead={lead} variant="cold" />
              ))
            )}
          </div>
        </section>
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
