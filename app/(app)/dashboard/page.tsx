import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { getKpisInRange } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function DashboardPage() {
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - 30);

  let kpis = null;
  let errorMsg = "";
  try {
    kpis = await getKpisInRange(from, to);
  } catch (e) {
    errorMsg = (e as Error).message || String(e);
  }

  return (
    <>
      <Topbar title="Tổng quan" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <h1 className="text-[22px] font-semibold tracking-tight mb-6">
          Tổng quan
        </h1>

        {errorMsg && (
          <div className="mb-6 rounded-2xl bg-[#fff5f5] border border-[#fecaca] p-4 text-[13px] font-mono text-[#991b1b]">
            <strong>getKpisInRange error:</strong> {errorMsg.slice(0, 500)}
          </div>
        )}

        {kpis && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KPICard label="🎓 Conversion" value={kpis.conversions.value} deltaPct={kpis.conversions.pct} deltaPositive={kpis.conversions.positive} />
            <KPICard label="🆕 Lead mới" value={kpis.newLeads.value} deltaPct={kpis.newLeads.pct} deltaPositive={kpis.newLeads.positive} />
            <KPICard label="💬 Đã tư vấn" value={kpis.engagedLeads.value} deltaPct={kpis.engagedLeads.pct} deltaPositive={kpis.engagedLeads.positive} />
            <KPICard label="📈 Conv rate" value={kpis.conversionRate.value} unit="%" />
          </div>
        )}

        {!kpis && !errorMsg && (
          <div className="rounded-2xl bg-subtle p-8 text-center text-[13px] text-muted">
            Đang tải KPI...
          </div>
        )}
      </main>
    </>
  );
}
