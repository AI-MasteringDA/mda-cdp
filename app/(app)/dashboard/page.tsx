import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { SimpleDonut } from "@/components/charts/SimpleDonut";
import { SimpleBar } from "@/components/charts/SimpleBar";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

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
  } catch { return 0; }
}

async function countLeads(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase.from("dim_lead").select("*", { count: "exact", head: true });
    return count ?? 0;
  } catch { return 0; }
}

async function countTouchpoints(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase.from("fact_touchpoint").select("*", { count: "exact", head: true });
    return count ?? 0;
  } catch { return 0; }
}

async function countLeadsBySource(src: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", src);
    return count ?? 0;
  } catch { return 0; }
}

async function countTouchpointsBySource(src: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase.from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("source", src);
    return count ?? 0;
  } catch { return 0; }
}

async function countTierBucket(min: number, max: number): Promise<number> {
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
      .gte("hot_score", min)
      .lte("hot_score", max);
    return count ?? 0;
  } catch { return 0; }
}

async function countWonStage(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase.from("dim_lead").select("*", { count: "exact", head: true }).eq("stage", "Đã chốt");
    return count ?? 0;
  } catch { return 0; }
}

async function getRecentTouchpoints(limit = 8) {
  try {
    const supabase = await createClient();
    const { data: touches } = await supabase
      .from("fact_touchpoint")
      .select("id, source, event_type, title, occurred_at, lead_id")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (!touches || touches.length === 0) return [];
    const leadIds = [...new Set(touches.map((t) => t.lead_id))];
    const { data: leads } = await supabase
      .from("dim_lead")
      .select("lead_id, full_name")
      .in("lead_id", leadIds);
    const leadMap = new Map((leads || []).map((l) => [l.lead_id, l.full_name]));
    return touches.map((t) => ({
      id: t.id,
      lead: leadMap.get(t.lead_id) || "—",
      title: t.title || "",
      source: t.source,
      type: t.event_type,
      at: new Date(t.occurred_at),
    }));
  } catch { return []; }
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "vừa xong";
  if (min < 60) return `${min}p`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

export default async function DashboardPage() {
  // SEQUENTIAL queries to avoid connection burst
  const totalLeads = await countLeads();
  const totalTouchpoints = await countTouchpoints();
  const conversions = await countEvent("conversion");
  const won = await countWonStage();
  const chats = await countEvent("chat");
  const chatStaff = await countEvent("chat_staff");
  const emailsSent = await countEvent("email_sent");
  const emailOpens = await countEvent("email_open");
  const hot = await countTierBucket(70, 100);
  const warm = await countTierBucket(40, 69);
  const cool = await countTierBucket(20, 39);
  const dormant = await countTierBucket(0, 19);
  const sfLeads = await countLeadsBySource("salesforce");
  const sfTp = await countTouchpointsBySource("salesforce");
  const smaxLeads = await countLeadsBySource("smax");
  const smaxTp = await countTouchpointsBySource("smax");
  const instLeads = await countLeadsBySource("instantly");
  const instTp = await countTouchpointsBySource("instantly");
  const webLeads = await countLeadsBySource("web");
  const webTp = await countTouchpointsBySource("web");
  const recent = await getRecentTouchpoints(10);

  const convRate = totalLeads ? Number((conversions / totalLeads * 100).toFixed(2)) : 0;
  const openRate = emailsSent ? Number((emailOpens / emailsSent * 100).toFixed(1)) : 0;
  const replyRate = chats ? Number((chatStaff / chats * 100).toFixed(0)) : 0;

  const tierData = [
    { name: "🔥 NÓNG", value: hot, color: "#ff3b30" },
    { name: "🌡 ẤM", value: warm, color: "#ff9500" },
    { name: "💧 MÁT", value: cool, color: "#5ac8fa" },
    { name: "💤 NGỦ ĐÔNG", value: dormant, color: "#3a3a3c" },
  ];

  const sourceLeads = [
    { label: "Salesforce", value: sfLeads, color: "#00a1e0" },
    { label: "Wix Website", value: webLeads, color: "#10b981" },
    { label: "Instantly", value: instLeads, color: "#f59e0b" },
    { label: "SMAX", value: smaxLeads, color: "#7c3aed" },
  ].sort((a, b) => b.value - a.value);

  const sourceTp = [
    { label: "Salesforce", value: sfTp, color: "#00a1e0" },
    { label: "Instantly", value: instTp, color: "#f59e0b" },
    { label: "Wix Website", value: webTp, color: "#10b981" },
    { label: "SMAX", value: smaxTp, color: "#7c3aed" },
  ].sort((a, b) => b.value - a.value);

  return (
    <>
      <Topbar title="Tổng quan" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight">Tổng quan workspace</h1>
          <p className="mt-1 text-[12px] text-muted">
            Chỉ số lifetime · cập nhật theo Vercel Cron mỗi 1h
          </p>
        </div>

        {/* KPI Row 1 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard label="🔥 Lead NÓNG" value={hot} deltaLabel={`/${(hot + warm + cool + dormant).toLocaleString("vi-VN")} total`} />
          <KPICard label="🎓 Conversion" value={conversions} deltaLabel={`${won} đã chốt`} />
          <KPICard label="📈 Conv rate" value={convRate} unit="%" deltaLabel="conv / total lead" />
          <KPICard label="🆕 Tổng lead" value={totalLeads.toLocaleString("vi-VN")} deltaLabel="trong workspace" />
        </div>

        {/* KPI Row 2 */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard label="💬 Lead chat" value={chats} deltaLabel={`${chatStaff} TVV reply`} />
          <KPICard label="↩ Reply rate" value={replyRate} unit="%" deltaLabel="reply / chat" />
          <KPICard label="📧 Email gửi" value={emailsSent} deltaLabel={`${emailOpens} đã mở`} />
          <KPICard label="📬 Open rate" value={openRate} unit="%" deltaLabel="opens / sent" />
        </div>

        {/* Tier Donut + Source Leads */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-5">
              <h3 className="text-[15px] font-semibold">Phân bố Lead theo tier</h3>
              <p className="mt-0.5 text-[12px] text-muted">Scoring hiện tại</p>
            </div>
            <SimpleDonut data={tierData} size={180} />
          </section>

          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-5">
              <h3 className="text-[15px] font-semibold">Lead theo nguồn</h3>
              <p className="mt-0.5 text-[12px] text-muted">Số lead unique mỗi source</p>
            </div>
            <SimpleBar data={sourceLeads} valueLabel="lead" />
          </section>
        </div>

        {/* Source Touchpoints + Total stats */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-5">
              <h3 className="text-[15px] font-semibold">Touchpoint theo nguồn</h3>
              <p className="mt-0.5 text-[12px] text-muted">Tổng số event mỗi source</p>
            </div>
            <SimpleBar data={sourceTp} valueLabel="events" />
          </section>

          <section className="hairline rounded-2xl bg-white p-6">
            <div className="mb-5">
              <h3 className="text-[15px] font-semibold">📊 Quy mô workspace</h3>
              <p className="mt-0.5 text-[12px] text-muted">Snapshot tại thời điểm</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">Lead</div>
                <div className="mt-1 text-[28px] font-semibold tabular-nums">{totalLeads.toLocaleString("vi-VN")}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">Touchpoint</div>
                <div className="mt-1 text-[28px] font-semibold tabular-nums">{totalTouchpoints.toLocaleString("vi-VN")}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">Đã chốt</div>
                <div className="mt-1 text-[28px] font-semibold tabular-nums text-[#22c55e]">{won.toLocaleString("vi-VN")}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">Avg tp/lead</div>
                <div className="mt-1 text-[28px] font-semibold tabular-nums">
                  {totalLeads ? (totalTouchpoints / totalLeads).toFixed(1) : "0"}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Recent Activity */}
        {recent.length > 0 && (
          <section className="mt-6 hairline rounded-2xl bg-white">
            <div className="hairline-b flex items-center justify-between px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold">⚡ Hoạt động realtime</h3>
                <p className="mt-0.5 text-[12px] text-muted">10 sự kiện mới nhất</p>
              </div>
              <Link href="/leads" className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-foreground">
                Tất cả lead
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {recent.map((r) => (
                <div key={r.id} className="flex items-start gap-3 px-6 py-3">
                  <div className="text-[11px] uppercase tracking-wider text-muted-2 w-16 shrink-0 mt-1">
                    {r.source}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] truncate">
                      <span className="font-medium">{r.lead}</span>
                      <span className="text-muted-2 ml-2">·</span>
                      <span className="text-muted ml-2">{r.title}</span>
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-2 tabular-nums shrink-0">
                    {formatRelative(r.at)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Navigation to other dashboards */}
        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <h3 className="text-[15px] font-semibold mb-3">🧭 Đi tới dashboard khác</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Link href="/dashboard/sales" className="rounded-xl border border-[var(--border-subtle)] px-4 py-3 hover:bg-subtle">
              <div className="text-[14px] font-medium">Sales / TVV</div>
              <div className="text-[11px] text-muted-2 mt-1">Hiệu suất TVV, conversion</div>
            </Link>
            <Link href="/dashboard/marketing" className="rounded-xl border border-[var(--border-subtle)] px-4 py-3 hover:bg-subtle">
              <div className="text-[14px] font-medium">Marketing</div>
              <div className="text-[11px] text-muted-2 mt-1">Source efficiency, campaigns</div>
            </Link>
            <Link href="/dashboard/funnel" className="rounded-xl border border-[var(--border-subtle)] px-4 py-3 hover:bg-subtle">
              <div className="text-[14px] font-medium">Conversion Funnel</div>
              <div className="text-[11px] text-muted-2 mt-1">5-stage funnel</div>
            </Link>
            <Link href="/dashboard/trends" className="rounded-xl border border-[var(--border-subtle)] px-4 py-3 hover:bg-subtle">
              <div className="text-[14px] font-medium">Trends</div>
              <div className="text-[11px] text-muted-2 mt-1">Hoạt động theo thời gian</div>
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
