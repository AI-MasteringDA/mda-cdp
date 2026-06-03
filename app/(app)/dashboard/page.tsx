import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function countEvent(eventType: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", eventType);
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function countLeads(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("dim_lead")
      .select("*", { count: "exact", head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function countTouchpoints(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function countHotLeads(): Promise<number> {
  try {
    const supabase = await createClient();
    const { data: latest } = await supabase
      .from("fact_lead_score")
      .select("scored_at")
      .order("scored_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest?.scored_at) return 0;
    const { count } = await supabase
      .from("fact_lead_score")
      .select("*", { count: "exact", head: true })
      .eq("scored_at", latest.scored_at)
      .gte("hot_score", 70);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function DashboardPage() {
  // FULLY SEQUENTIAL — no Promise.all, no parallel anything
  const totalLeads = await countLeads();
  const totalTouchpoints = await countTouchpoints();
  const conversions = await countEvent("conversion");
  const chats = await countEvent("chat");
  const emailsSent = await countEvent("email_sent");
  const emailOpens = await countEvent("email_open");
  const hotLeads = await countHotLeads();
  const newLeads = await countEvent("lead_created");

  const convRate = newLeads ? Number((conversions / newLeads * 100).toFixed(2)) : 0;
  const openRate = emailsSent ? Number((emailOpens / emailsSent * 100).toFixed(1)) : 0;

  return (
    <>
      <Topbar title="Tổng quan" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <h1 className="text-[22px] font-semibold tracking-tight mb-6">
          Tổng quan — Cumulative metrics
        </h1>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard label="🔥 Lead NÓNG" value={hotLeads} deltaLabel="cần gọi NGAY" />
          <KPICard label="🎓 Conversion" value={conversions} deltaLabel={`từ ${totalLeads.toLocaleString("vi-VN")} lead`} />
          <KPICard label="📈 Conversion rate" value={convRate} unit="%" deltaLabel="conv / lead mới" />
          <KPICard label="🆕 Lead mới" value={newLeads} deltaLabel="lifetime" />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard label="💬 Lead chat" value={chats} deltaLabel="tổng lượt" />
          <KPICard label="📧 Email gửi" value={emailsSent} deltaLabel="lifetime" />
          <KPICard label="👁 Email opens" value={emailOpens} deltaLabel="lifetime" />
          <KPICard label="📬 Open rate" value={openRate} unit="%" deltaLabel="opens / sent" />
        </div>

        <div className="mt-8 hairline rounded-2xl bg-white p-6">
          <h3 className="text-[15px] font-semibold mb-3">📊 Tổng quan workspace</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">Tổng lead</div>
              <div className="mt-1 text-[24px] font-semibold tabular-nums">{totalLeads.toLocaleString("vi-VN")}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">Tổng touchpoint</div>
              <div className="mt-1 text-[24px] font-semibold tabular-nums">{totalTouchpoints.toLocaleString("vi-VN")}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 hairline rounded-2xl bg-white p-6">
          <h3 className="text-[15px] font-semibold mb-3">🔗 Đi tới các trang khác</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <a href="/dashboard/sales" className="rounded-lg border border-[var(--border-subtle)] px-4 py-3 text-[13px] hover:bg-subtle">→ Sales / TVV</a>
            <a href="/dashboard/marketing" className="rounded-lg border border-[var(--border-subtle)] px-4 py-3 text-[13px] hover:bg-subtle">→ Marketing</a>
            <a href="/dashboard/funnel" className="rounded-lg border border-[var(--border-subtle)] px-4 py-3 text-[13px] hover:bg-subtle">→ Funnel</a>
            <a href="/dashboard/trends" className="rounded-lg border border-[var(--border-subtle)] px-4 py-3 text-[13px] hover:bg-subtle">→ Trends</a>
          </div>
        </div>
      </main>
    </>
  );
}
