import { Topbar } from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { DashboardTabs } from "@/components/DashboardTabs";
import { SimpleBar } from "@/components/charts/SimpleBar";
import { createClient } from "@/lib/supabase/server";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function countEvent(t: string): Promise<number> {
  try {
    const sb = await createClient();
    const { count } = await sb.from("fact_touchpoint").select("*", { count: "exact", head: true }).eq("event_type", t);
    return count ?? 0;
  } catch { return 0; }
}

type TvvRow = { name: string; leadCount: number; converted: number; replies: number; conversionRate: number };

async function getTvvRanking(): Promise<TvvRow[]> {
  try {
    const sb = await createClient();
    const { data: leads } = await sb
      .from("dim_lead")
      .select("assignee, conversion_count, chat_staff_count")
      .not("assignee", "is", null)
      .range(0, 4999);
    if (!leads) return [];
    const m = new Map<string, { lc: number; cv: number; rp: number }>();
    for (const l of leads) {
      const name = (l.assignee || "—").trim();
      if (!m.has(name)) m.set(name, { lc: 0, cv: 0, rp: 0 });
      const r = m.get(name)!;
      r.lc++;
      if ((l.conversion_count ?? 0) > 0) r.cv++;
      r.rp += l.chat_staff_count ?? 0;
    }
    return [...m.entries()]
      .map(([name, r]) => ({
        name,
        leadCount: r.lc,
        converted: r.cv,
        replies: r.rp,
        conversionRate: r.lc ? Number((r.cv / r.lc * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.leadCount - a.leadCount)
      .slice(0, 15);
  } catch { return []; }
}

export default async function SalesDashboard() {
  const conversions = await countEvent("conversion");
  const chats = await countEvent("chat");
  const chatStaff = await countEvent("chat_staff");
  const calls = await countEvent("call");
  const tvv = await getTvvRanking();

  const replyRate = chats ? Number((chatStaff / chats * 100).toFixed(0)) : 0;
  const topTvv = tvv.slice(0, 5).map((t) => ({ label: t.name, value: t.leadCount, color: "#3b82f6" }));

  return (
    <>
      <Topbar title="Sales / TVV" />
      <DashboardTabs />

      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight">Sales Performance</h1>
          <p className="mt-1 text-[12px] text-muted">Hiệu suất TVV · conversion · chat response</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard label="🎓 Conversion (lifetime)" value={conversions} deltaLabel="đã chốt khóa" />
          <KPICard label="💬 Lead chat đến" value={chats} deltaLabel="tổng lượt" />
          <KPICard label="↩ TVV reply" value={chatStaff} deltaLabel="lifetime" />
          <KPICard label="📈 Reply rate" value={replyRate} unit="%" deltaLabel="reply/chat" />
        </div>

        {topTvv.length > 0 && (
          <section className="mt-8 hairline rounded-2xl bg-white p-6">
            <div className="mb-5">
              <h3 className="text-[15px] font-semibold">Top 5 TVV theo lead phụ trách</h3>
              <p className="mt-0.5 text-[12px] text-muted">Lead count lifetime</p>
            </div>
            <SimpleBar data={topTvv} valueLabel="lead" />
          </section>
        )}

        <section className="mt-6 hairline rounded-2xl bg-white">
          <div className="hairline-b px-6 py-4">
            <h3 className="text-[15px] font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" strokeWidth={1.75} /> Bảng xếp hạng TVV
            </h3>
            <p className="mt-0.5 text-[12px] text-muted">Top {tvv.length} theo số lead phụ trách</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-muted-2">
                <tr>
                  <th className="px-6 py-3 font-medium">#</th>
                  <th className="px-6 py-3 font-medium">TVV</th>
                  <th className="px-6 py-3 font-medium text-right">Lead</th>
                  <th className="px-6 py-3 font-medium text-right">Conversion</th>
                  <th className="px-6 py-3 font-medium text-right">Replies</th>
                  <th className="px-6 py-3 font-medium text-right">Conv rate</th>
                </tr>
              </thead>
              <tbody>
                {tvv.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-muted-2">Chưa có TVV nào có data</td></tr>
                ) : (
                  tvv.map((t, i) => (
                    <tr key={t.name} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-subtle">
                      <td className="px-6 py-3 tabular-nums text-muted-2">{i + 1}</td>
                      <td className="px-6 py-3 font-medium">{t.name}</td>
                      <td className="px-6 py-3 text-right tabular-nums">{t.leadCount.toLocaleString("vi-VN")}</td>
                      <td className="px-6 py-3 text-right tabular-nums">{t.converted}</td>
                      <td className="px-6 py-3 text-right tabular-nums text-muted">{t.replies}</td>
                      <td className="px-6 py-3 text-right tabular-nums font-medium">{t.conversionRate}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-6 text-[12px] text-muted-2">Calls lifetime: {calls.toLocaleString("vi-VN")}</div>
      </main>
    </>
  );
}
