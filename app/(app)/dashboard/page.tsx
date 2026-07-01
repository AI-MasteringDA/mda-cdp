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
  // NOTE: Can't compute email open rate because email_sent tracks only SF (~590)
  // while email_open tracks only Instantly (~50k). Different systems, apples-vs-oranges.
  // Show absolute counts instead of misleading percentage.
  // TODO: pull Instantly sends too → compute Instantly open rate properly per source.
  const chatResponseRate = chats && chatStaff ? Math.min(100, Number(((chatStaff / chats) * 100).toFixed(0))) : 0;

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

      <main className="mx-auto max-w-[1400px] px-8 py-12">
        {/* Hero header */}
        <div className="mb-12 anim-fade-up">
          <span className="eyebrow">Workspace Overview</span>
          <h1 className="mt-4 text-[44px] font-bold tracking-[-0.045em] leading-[1.05] font-display">
            Mọi chỉ số quan trọng,<br />
            <span className="text-muted-2">trong 1 view duy nhất.</span>
          </h1>
          <p className="mt-4 text-[15px] text-muted max-w-2xl leading-relaxed">
            Cập nhật mỗi giờ qua Vercel Cron · Realtime opens/clicks qua Instantly webhook ·
            Scoring dựa trên engagement đa kênh.
          </p>
        </div>

        {/* KPI Grid — 2x4 with double-bezel */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          <div className="anim-fade-up delay-1"><KPICard label="Lead NÓNG" value={hot} deltaLabel={`trên ${(hot + warm + cool + dormant).toLocaleString("vi-VN")} lead`} accent="hot" /></div>
          <div className="anim-fade-up delay-2"><KPICard label="Conversion" value={conversions} deltaLabel={`${won} đã chốt`} accent="success" /></div>
          <div className="anim-fade-up delay-3"><KPICard label="Conv Rate" value={convRate} unit="%" deltaLabel="conv / total" accent="success" /></div>
          <div className="anim-fade-up delay-4"><KPICard label="Tổng Lead" value={totalLeads.toLocaleString("vi-VN")} deltaLabel="lifetime" /></div>
          <div className="anim-fade-up delay-5"><KPICard label="Lead Chat" value={chats} deltaLabel={`${chatStaff} TVV chat`} accent="cool" /></div>
          <div className="anim-fade-up delay-6"><KPICard label="Chat Response" value={chatResponseRate} unit="%" deltaLabel="TVV reply / lead chat" accent="cool" /></div>
          <div className="anim-fade-up delay-7"><KPICard label="Email Sent (SF)" value={emailsSent} deltaLabel="Salesforce outbound" accent="warm" /></div>
          <div className="anim-fade-up delay-8"><KPICard label="Email Opens (Instantly)" value={emailOpens.toLocaleString('vi-VN')} deltaLabel="Instantly opens" accent="warm" /></div>
        </div>

        {/* Section: Lead distribution */}
        <div className="mt-16">
          <span className="eyebrow">Lead Intelligence</span>
          <h2 className="mt-3 text-[28px] font-bold tracking-[-0.03em]">Phân bố & nguồn data</h2>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="bezel anim-fade-up card-lift" style={{ animationDelay: "300ms" }}>
            <div className="bezel-inner p-7">
              <div className="mb-6">
                <span className="eyebrow">Tier Distribution</span>
                <h3 className="mt-2 text-[18px] font-bold tracking-tight">Phân bố scoring</h3>
              </div>
              <SimpleDonut data={tierData} size={180} />
            </div>
          </section>

          <section className="bezel anim-fade-up card-lift" style={{ animationDelay: "400ms" }}>
            <div className="bezel-inner p-7">
              <div className="mb-6">
                <span className="eyebrow">Source Mix</span>
                <h3 className="mt-2 text-[18px] font-bold tracking-tight">Lead theo nguồn</h3>
              </div>
              <SimpleBar data={sourceLeads} valueLabel="lead" />
            </div>
          </section>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="bezel anim-fade-up card-lift" style={{ animationDelay: "500ms" }}>
            <div className="bezel-inner p-7">
              <div className="mb-6">
                <span className="eyebrow">Activity Volume</span>
                <h3 className="mt-2 text-[18px] font-bold tracking-tight">Touchpoint theo nguồn</h3>
              </div>
              <SimpleBar data={sourceTp} valueLabel="events" />
            </div>
          </section>

          <section className="bezel anim-fade-up card-lift" style={{ animationDelay: "550ms" }}>
            <div className="bezel-inner p-7">
              <div className="mb-6">
                <span className="eyebrow">Workspace Scale</span>
                <h3 className="mt-2 text-[18px] font-bold tracking-tight">Snapshot</h3>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-6">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-2 font-semibold">Lead</div>
                  <div className="mt-2 text-[36px] font-bold tabular-nums tracking-[-0.03em] gradient-num">{totalLeads.toLocaleString("vi-VN")}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-2 font-semibold">Touchpoint</div>
                  <div className="mt-2 text-[36px] font-bold tabular-nums tracking-[-0.03em] gradient-num">{totalTouchpoints.toLocaleString("vi-VN")}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-2 font-semibold">Đã chốt</div>
                  <div className="mt-2 text-[36px] font-bold tabular-nums tracking-[-0.03em] text-[var(--success)]">{won.toLocaleString("vi-VN")}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-2 font-semibold">Avg tp/lead</div>
                  <div className="mt-2 text-[36px] font-bold tabular-nums tracking-[-0.03em] gradient-num">
                    {totalLeads ? (totalTouchpoints / totalLeads).toFixed(1) : "0"}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Activity */}
        {recent.length > 0 && (
          <div className="mt-16">
            <div className="mb-6 flex items-end justify-between">
              <div>
                <span className="eyebrow">Live Feed</span>
                <h2 className="mt-3 text-[28px] font-bold tracking-[-0.03em]">Hoạt động realtime</h2>
              </div>
              <Link href="/leads" className="press group inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-[13px] font-semibold text-white">
                Xem tất cả lead
                <ChevronRight className="hover-arrow h-4 w-4" strokeWidth={2} />
              </Link>
            </div>
            <section className="bezel anim-fade-up" style={{ animationDelay: "650ms" }}>
              <div className="bezel-inner divide-y divide-[var(--border-subtle)]">
                {recent.map((r, i) => (
                  <div key={r.id} className="anim-slide-in flex items-center gap-5 px-7 py-4 transition-colors hover:bg-[var(--subtle)]" style={{ animationDelay: `${700 + i * 40}ms` }}>
                    <div className="inline-flex items-center gap-2 rounded-full bg-[var(--subtle)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-2 shrink-0">
                      {r.source}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px]">
                        <span className="font-semibold">{r.lead}</span>
                        <span className="text-muted-2 mx-2">·</span>
                        <span className="text-muted">{r.title}</span>
                      </div>
                    </div>
                    <div className="text-[12px] text-muted-2 tabular-nums shrink-0 font-medium">
                      {formatRelative(r.at)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Explore other dashboards */}
        <div className="mt-16">
          <span className="eyebrow">Deep Dive</span>
          <h2 className="mt-3 text-[28px] font-bold tracking-[-0.03em]">Khám phá dashboard khác</h2>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/dashboard/sales",     title: "Sales / TVV",     desc: "Hiệu suất TVV · conversion · response rate",    delay: 700 },
            { href: "/dashboard/marketing", title: "Marketing",        desc: "Source efficiency · campaign performance",       delay: 760 },
            { href: "/dashboard/funnel",    title: "Conversion Funnel",desc: "5-stage funnel · drop-off · insights",           delay: 820 },
            { href: "/dashboard/trends",    title: "Trends & Cohort",  desc: "Weekly buckets · activity trend · cohort",       delay: 880 },
          ].map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="bezel press card-lift group anim-fade-up"
              style={{ animationDelay: `${card.delay}ms` }}
            >
              <div className="bezel-inner p-6">
                <div className="flex items-start justify-between mb-4">
                  <span className="eyebrow">View</span>
                  <ChevronRight className="hover-arrow h-4 w-4 text-muted-2" strokeWidth={1.75} />
                </div>
                <h3 className="text-[18px] font-bold tracking-tight">{card.title}</h3>
                <p className="mt-2 text-[12px] text-muted leading-relaxed">{card.desc}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Footer breathing space */}
        <div className="h-24" />
      </main>
    </>
  );
}
