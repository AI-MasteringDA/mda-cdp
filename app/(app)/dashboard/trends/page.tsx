import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { SimpleBar } from "@/components/charts/SimpleBar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function countInRange(event: string, fromDays: number, toDays: number): Promise<number> {
  try {
    const sb = await createClient();
    const now = new Date();
    const from = new Date(now); from.setDate(from.getDate() - fromDays);
    const to = new Date(now); to.setDate(to.getDate() - toDays);
    const { count } = await sb
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", event)
      .gte("occurred_at", from.toISOString())
      .lt("occurred_at", to.toISOString());
    return count ?? 0;
  } catch { return 0; }
}

export default async function TrendsDashboard() {
  // Conversions by weekly buckets (last 8 weeks, sequential)
  const w1 = await countInRange("conversion", 7, 0);
  const w2 = await countInRange("conversion", 14, 7);
  const w3 = await countInRange("conversion", 21, 14);
  const w4 = await countInRange("conversion", 28, 21);
  const w5 = await countInRange("conversion", 35, 28);
  const w6 = await countInRange("conversion", 42, 35);
  const w7 = await countInRange("conversion", 49, 42);
  const w8 = await countInRange("conversion", 56, 49);

  // New leads by weekly buckets
  const l1 = await countInRange("lead_created", 7, 0);
  const l2 = await countInRange("lead_created", 14, 7);
  const l3 = await countInRange("lead_created", 21, 14);
  const l4 = await countInRange("lead_created", 28, 21);

  // Activity today / yesterday / week / month
  const chatToday = await countInRange("chat", 1, 0);
  const chatWeek = await countInRange("chat", 7, 0);
  const chatMonth = await countInRange("chat", 30, 0);

  const convThisWeek = w1;
  const convLastWeek = w2;
  const delta = convLastWeek ? Math.abs(Number(((convThisWeek - convLastWeek) / convLastWeek * 100).toFixed(1))) : 0;
  const positive = convThisWeek >= convLastWeek;

  const convTrend = [
    { label: "Tuần này", value: w1, color: "#22c55e" },
    { label: "1 tuần trước", value: w2, color: "#22c55e" },
    { label: "2 tuần trước", value: w3, color: "#84cc16" },
    { label: "3 tuần trước", value: w4, color: "#84cc16" },
    { label: "4 tuần trước", value: w5, color: "#a3a3a3" },
    { label: "5 tuần trước", value: w6, color: "#a3a3a3" },
    { label: "6 tuần trước", value: w7, color: "#a3a3a3" },
    { label: "7 tuần trước", value: w8, color: "#a3a3a3" },
  ];

  const newLeadTrend = [
    { label: "Tuần này", value: l1, color: "#3b82f6" },
    { label: "1 tuần trước", value: l2, color: "#3b82f6" },
    { label: "2 tuần trước", value: l3, color: "#93c5fd" },
    { label: "3 tuần trước", value: l4, color: "#93c5fd" },
  ];

  return (
    <>
      <Topbar title="Trends" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight">Xu hướng theo thời gian</h1>
          <p className="mt-1 text-[12px] text-muted">Conversion · lead mới · chat — 8 tuần qua</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard label="🎓 Conv tuần này" value={convThisWeek} deltaPct={delta} deltaPositive={positive} deltaLabel="vs tuần trước" />
          <KPICard label="🆕 Lead mới tuần" value={l1} deltaLabel={`${l2} tuần trước`} />
          <KPICard label="💬 Chat tuần này" value={chatWeek} deltaLabel={`${chatToday} hôm nay`} />
          <KPICard label="💬 Chat tháng" value={chatMonth} deltaLabel="30 ngày" />
        </div>

        <section className="mt-8 hairline rounded-2xl bg-white p-6">
          <div className="mb-5">
            <h3 className="text-[15px] font-semibold">Conversion theo tuần (8 tuần)</h3>
            <p className="mt-0.5 text-[12px] text-muted">Tuần này → cũ dần. Xanh = gần đây, xám = 4+ tuần</p>
          </div>
          <SimpleBar data={convTrend} valueLabel="conversion" />
        </section>

        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <div className="mb-5">
            <h3 className="text-[15px] font-semibold">Lead mới theo tuần (4 tuần)</h3>
          </div>
          <SimpleBar data={newLeadTrend} valueLabel="lead" />
        </section>
      </main>
    </>
  );
}
