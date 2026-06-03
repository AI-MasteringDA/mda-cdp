import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { SimpleBar } from "@/components/charts/SimpleBar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function countEvent(t: string): Promise<number> {
  try {
    const sb = await createClient();
    const { count } = await sb.from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("event_type", t);
    return count ?? 0;
  } catch { return 0; }
}
async function leadsBySource(s: string): Promise<number> {
  try {
    const sb = await createClient();
    const { count } = await sb.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", s);
    return count ?? 0;
  } catch { return 0; }
}
async function tpBySource(s: string): Promise<number> {
  try {
    const sb = await createClient();
    const { count } = await sb.from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("source", s);
    return count ?? 0;
  } catch { return 0; }
}
async function convBySource(s: string): Promise<number> {
  try {
    const sb = await createClient();
    const { count } = await sb
      .from("dim_lead")
      .select("*", { count: "exact", head: true })
      .eq("source", s)
      .gt("conversion_count", 0);
    return count ?? 0;
  } catch { return 0; }
}

export default async function MarketingDashboard() {
  const emailsSent = await countEvent("email_sent");
  const emailOpens = await countEvent("email_open");
  const emailClicks = await countEvent("email_click");
  const newLeads = await countEvent("lead_created");

  const openRate = emailsSent ? Number((emailOpens / emailsSent * 100).toFixed(1)) : 0;
  const clickRate = emailsSent ? Number((emailClicks / emailsSent * 100).toFixed(2)) : 0;

  const sfL = await leadsBySource("salesforce");
  const sfTp = await tpBySource("salesforce");
  const sfC = await convBySource("salesforce");
  const smaxL = await leadsBySource("smax");
  const smaxTp = await tpBySource("smax");
  const smaxC = await convBySource("smax");
  const instL = await leadsBySource("instantly");
  const instTp = await tpBySource("instantly");
  const instC = await convBySource("instantly");
  const webL = await leadsBySource("web");
  const webTp = await tpBySource("web");
  const webC = await convBySource("web");

  const sources = [
    { id: "salesforce", name: "Salesforce", color: "#00a1e0", leads: sfL, touchpoints: sfTp, converted: sfC },
    { id: "smax", name: "SMAX", color: "#7c3aed", leads: smaxL, touchpoints: smaxTp, converted: smaxC },
    { id: "instantly", name: "Instantly", color: "#f59e0b", leads: instL, touchpoints: instTp, converted: instC },
    { id: "web", name: "Wix Website", color: "#10b981", leads: webL, touchpoints: webTp, converted: webC },
  ];

  const tpBarData = sources.map((s) => ({ label: s.name, value: s.touchpoints, color: s.color }))
    .sort((a, b) => b.value - a.value);
  const leadBarData = sources.map((s) => ({ label: s.name, value: s.leads, color: s.color }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <Topbar title="Marketing" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight">Marketing & Channels</h1>
          <p className="mt-1 text-[12px] text-muted">Email engagement · source efficiency</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard label="📧 Email gửi" value={emailsSent} deltaLabel="lifetime" />
          <KPICard label="👁 Email opens" value={emailOpens} deltaLabel={`${openRate}% open rate`} />
          <KPICard label="🖱 Email clicks" value={emailClicks} deltaLabel={`${clickRate}% CTR`} />
          <KPICard label="🆕 Tổng lead mới" value={newLeads} deltaLabel="lifetime" />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-5">
              <h3 className="text-[15px] font-semibold">Touchpoint theo source</h3>
            </div>
            <SimpleBar data={tpBarData} valueLabel="events" />
          </section>
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-5">
              <h3 className="text-[15px] font-semibold">Lead theo source</h3>
            </div>
            <SimpleBar data={leadBarData} valueLabel="leads" />
          </section>
        </div>

        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <div className="mb-5">
            <h3 className="text-[15px] font-semibold">Source efficiency — conversion rate</h3>
            <p className="mt-0.5 text-[12px] text-muted">% lead chuyển đổi trong mỗi nguồn</p>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {sources.map((s) => (
              <div key={s.id} className="rounded-xl border border-[var(--border-subtle)] p-4">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  <span className="text-[12px] font-medium uppercase tracking-wider">{s.name}</span>
                </div>
                <div className="mt-3 text-[24px] font-semibold tabular-nums">
                  {s.leads ? (s.converted / s.leads * 100).toFixed(2) : "0"}%
                </div>
                <div className="text-[11px] text-muted-2">
                  {s.converted}/{s.leads.toLocaleString("vi-VN")} lead
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
