import { Chip } from "@/components/ui/Chip";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";
import { AuditDateFilter } from "@/components/AuditDateFilter";
import { getAuditData, needsFollowup, parseRange } from "@/lib/smax-audit";
import { formatRelativeVi } from "@/lib/utils";
import { BellRing, Flame, Thermometer } from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SP = Promise<{ from?: string; to?: string }>;

export default async function FollowupPage({ searchParams }: { searchParams: SP }) {
  const range = parseRange(await searchParams);
  const data = await getAuditData(range);
  const candidates = needsFollowup(data, 3).sort(
    (a, b) => a.lastActivity.localeCompare(b.lastActivity) // im ắng lâu nhất lên đầu
  );
  const hot = candidates.filter((l) => l.lifecycle === "hot");
  const warm = candidates.filter((l) => l.lifecycle === "warm");

  const quietDays = (iso: string) =>
    Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);

  const Section = ({
    title,
    icon: Icon,
    color,
    list,
  }: {
    title: string;
    icon: typeof Flame;
    color: string;
    list: typeof candidates;
  }) => (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4.5 w-4.5" style={{ color }} strokeWidth={1.75} />
        <h2 className="text-[17px] font-semibold">
          {title} <span className="text-muted font-normal">— {list.length} leads</span>
        </h2>
      </div>
      {list.length === 0 ? (
        <p className="text-[13px] text-muted">Không có lead nào im ắng quá 3 ngày. 🎉</p>
      ) : (
        <div className="bezel">
          <div className="bezel-inner overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left">
                  <th className="px-5 py-3 eyebrow">Khách</th>
                  <th className="px-5 py-3 eyebrow">Contact</th>
                  <th className="px-5 py-3 eyebrow">Im ắng</th>
                  <th className="px-5 py-3 eyebrow">Hoạt động cuối</th>
                  <th className="px-5 py-3 eyebrow text-right">Tổng chats</th>
                </tr>
              </thead>
              <tbody>
                {list.map((l) => (
                  <tr key={l.lead_id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-subtle/50">
                    <td className="px-5 py-3 font-semibold whitespace-nowrap">{l.name}</td>
                    <td className="px-5 py-3 text-muted whitespace-nowrap tabular-nums">{l.phone || l.email || "—"}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <Chip variant={quietDays(l.lastActivity) >= 7 ? "hot" : "warm"}>
                        {quietDays(l.lastActivity)} ngày
                      </Chip>
                    </td>
                    <td className="px-5 py-3 text-muted whitespace-nowrap tabular-nums">
                      {formatRelativeVi(new Date(l.lastActivity))}
                    </td>
                    <td className="px-5 py-3 text-right text-muted tabular-nums">{l.totalChats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <main className="mx-auto max-w-[1280px] px-8 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Follow-up Hot &amp; Warm</h1>
          <p className="mt-1 text-[14px] text-muted">
            Lead Hot/Warm không có tin nhắn mới ≥ 3 ngày (đã loại &quot;Đã chốt&quot;) — im ắng lâu nhất
            xếp trên. Đây là danh sách gọi lại tuần này của TVV.
          </p>
        </div>
        <AuditDateFilter from={range.from} to={range.to} />
      </div>
      {candidates.length === 0 ? (
        <EmptyConfigCard
          icon={BellRing}
          title="Không có lead nào cần follow-up"
          description="Mọi lead Hot/Warm đều có tương tác trong 3 ngày gần nhất."
        />
      ) : (
        <>
          <Section title="🔥 Hot Lead im ắng" icon={Flame} color="var(--hot)" list={hot} />
          <Section title="Warm Lead im ắng" icon={Thermometer} color="var(--warm)" list={warm} />
        </>
      )}
    </main>
  );
}
