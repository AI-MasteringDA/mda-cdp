import { Topbar } from "@/components/Topbar";
import { DashboardTabs } from "@/components/DashboardTabs";
import { FunnelBar } from "@/components/charts/FunnelBar";
import { KPICard } from "@/components/KPICard";
import { getConversionFunnel } from "@/lib/supabase/queries";
import { GitBranch } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FunnelDashboard() {
  const funnel = await getConversionFunnel();
  const total = funnel[0]?.count ?? 0;
  const converted = funnel[funnel.length - 1]?.count ?? 0;
  const engaged = funnel[1]?.count ?? 0;
  const chatted = funnel[3]?.count ?? 0;

  const cohortConvRate = total ? (converted / total * 100).toFixed(2) : "0.00";
  const engageRate = total ? (engaged / total * 100).toFixed(1) : "0";
  const chatToConvRate = chatted ? (converted / chatted * 100).toFixed(1) : "0";

  return (
    <>
      <Topbar title="Conversion Funnel" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight">Conversion Funnel</h1>
          <p className="mt-1 text-[12px] text-muted">
            Lead chuyển đổi qua từng giai đoạn · lifetime
          </p>
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            label="🆕 Tổng lead"
            value={total}
            deltaLabel="lifetime"
          />
          <KPICard
            label="💡 Engagement rate"
            value={engageRate}
            unit="%"
            deltaLabel="có >1 touchpoint"
          />
          <KPICard
            label="🎓 Conversion (lifetime)"
            value={converted}
            deltaLabel={`${cohortConvRate}% từ tổng`}
          />
          <KPICard
            label="💬 Chat → Conv"
            value={chatToConvRate}
            unit="%"
            deltaLabel="có chat → chốt"
          />
        </div>

        {/* Funnel bars */}
        <section className="mt-8 hairline rounded-2xl bg-white p-6">
          <div className="mb-6 flex items-center gap-2">
            <GitBranch className="h-4 w-4" strokeWidth={1.75} />
            <h3 className="text-[15px] font-semibold tracking-tight">5-stage funnel</h3>
          </div>
          <FunnelBar data={funnel} />
          <div className="mt-6 rounded-xl bg-subtle p-4 text-[12px] text-muted leading-relaxed">
            <strong className="text-foreground">Đọc số:</strong> Mỗi tầng phía dưới là subset của tầng trên.
            Số phần trăm bên phải = drop-off rate (bao nhiêu lead không đi tiếp sang tầng sau).
            Tầng cuối (Đã chốt) chia cho Tổng lead = lifetime conversion rate ({cohortConvRate}%).
          </div>
        </section>

        {/* Insights cards */}
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <section className="hairline rounded-2xl bg-white p-6">
            <h4 className="text-[14px] font-semibold mb-2">💡 Insight</h4>
            <p className="text-[13px] text-muted leading-relaxed">
              Lead có <strong>chat</strong> với MDA có tỉ lệ chốt cao gấp{" "}
              <strong className="text-foreground">{
                cohortConvRate !== "0.00"
                  ? (parseFloat(chatToConvRate) / parseFloat(cohortConvRate)).toFixed(1)
                  : "?"
              }x</strong> so với toàn bộ lead.
              Đây là tín hiệu mạnh nhất → ưu tiên chuyển lead vào kênh chat sớm.
            </p>
          </section>

          <section className="hairline rounded-2xl bg-white p-6">
            <h4 className="text-[14px] font-semibold mb-2">🎯 Action</h4>
            <p className="text-[13px] text-muted leading-relaxed">
              Tầng <strong>Engaged → Đã nhận email</strong> đang là nơi mất nhiều lead nhất.
              Cần tăng cường chuyển từ form_submit / lead_created → đưa vào campaign email
              nuôi nhanh hơn (rút từ 7 ngày → 2 ngày).
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
