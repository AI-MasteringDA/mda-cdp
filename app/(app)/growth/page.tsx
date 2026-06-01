import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { getAllLeadsCount, getLeadsBySource, getSyncJobs } from "@/lib/supabase/queries";
import { TrendingUp, AlertTriangle } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  lark: "Lark",
  fanpage: "Fanpage",
  web: "Website",
};

export default async function GrowthOverviewPage() {
  const [totalLeads, leadsBySource, jobs] = await Promise.all([
    getAllLeadsCount(),
    getLeadsBySource(),
    getSyncJobs(20),
  ]);
  const totalTouchpoints24h = jobs
    .filter((j) => Date.now() - j.startedAt.getTime() < 24 * 3600_000)
    .reduce((sum, j) => sum + j.recordsMerged, 0);

  const sourceEntries = Object.entries(leadsBySource).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Topbar title="Tổng quan Growth" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Tổng quan tăng trưởng
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Đọc thật từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">dim_lead</code> +
            {" "}<code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">sync_job</code>.
            Attribution/CAC/funnel chi tiết cần dữ liệu doanh thu + spend (chưa có).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <KPICard label="Tổng lead trong hệ thống" value={totalLeads.toLocaleString("vi-VN")} />
          <KPICard label="Touchpoint 24h qua" value={totalTouchpoints24h.toLocaleString("vi-VN")} />
          <KPICard label="Nguồn data đang chảy" value={sourceEntries.length} />
          <KPICard label="Sync jobs 24h" value={jobs.length} />
        </div>

        <section className="hairline rounded-2xl bg-white mb-6">
          <div className="hairline-b px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">Lead theo nguồn</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Phân bổ nguồn data thật — đây là số người đã có ít nhất 1 lần chạm.
            </p>
          </div>
          <div className="p-3">
            {sourceEntries.length === 0 ? (
              <div className="px-6 py-8 text-center text-[13px] text-muted-2">
                Chưa có lead. Chạy ETL để có data.
              </div>
            ) : (
              sourceEntries.map(([source, count]) => {
                const pct = totalLeads > 0 ? (count / totalLeads) * 100 : 0;
                return (
                  <div key={source} className="px-3 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[13px] font-medium">{SOURCE_LABEL[source] ?? source}</span>
                      <span className="text-[12px] tabular-nums">
                        {count.toLocaleString("vi-VN")} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-subtle">
                      <div className="h-full bg-foreground rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="hairline rounded-2xl bg-[#fff8f0] p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--warm)]" strokeWidth={1.75} />
            <div className="flex-1">
              <h3 className="text-[14px] font-semibold tracking-tight">
                Cần thêm data để có Attribution / CAC / Funnel đầy đủ
              </h3>
              <p className="mt-1 text-[12px] text-muted leading-relaxed">
                Hiện tại chỉ có data lead + touchpoint. Để tính được{" "}
                <strong>"kênh nào ra học viên đóng tiền"</strong> cần thêm:
              </p>
              <ul className="mt-2 ml-4 list-disc text-[12px] text-muted space-y-1">
                <li>Định nghĩa "1 học viên" = stage nào trong Salesforce</li>
                <li>Spend data (Google Ads, FB Ads, TikTok Ads) — đổ về bảng riêng</li>
                <li>Multi-touch attribution rule (first-touch / last-touch / linear)</li>
                <li>Doanh thu mỗi học viên (từ Salesforce Opportunity)</li>
              </ul>
              <div className="mt-4 flex gap-3">
                <Link href="/attribution" className="text-[12px] font-medium text-[var(--accent)] hover:underline">
                  Xem Attribution →
                </Link>
                <Link href="/funnel" className="text-[12px] font-medium text-[var(--accent)] hover:underline">
                  Xem Funnel →
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
