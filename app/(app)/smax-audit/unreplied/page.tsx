import { Chip } from "@/components/ui/Chip";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";
import { AuditDateFilter } from "@/components/AuditDateFilter";
import { getAuditData, parseRange, type AuditLead } from "@/lib/smax-audit";
import { formatRelativeVi } from "@/lib/utils";
import { MessageCircleWarning } from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SP = Promise<{ from?: string; to?: string }>;

const LIFECYCLE_CHIP: Record<AuditLead["lifecycle"], { label: string; variant: "hot" | "warm" | "cool" | "outline" }> = {
  hot: { label: "Hot", variant: "hot" },
  warm: { label: "Warm", variant: "warm" },
  cold: { label: "Cold", variant: "cool" },
  none: { label: "Chưa tag", variant: "outline" },
};

export default async function UnrepliedPage({ searchParams }: { searchParams: SP }) {
  const range = parseRange(await searchParams);
  const data = await getAuditData(range);
  const list = data.leads.filter((l) => l.unreplied);
  const hotFirst = [...list].sort((a, b) => {
    const rank = { hot: 0, warm: 1, none: 2, cold: 3 } as const;
    return rank[a.lifecycle] - rank[b.lifecycle] || b.lastActivity.localeCompare(a.lastActivity);
  });

  return (
    <main className="mx-auto max-w-[1280px] px-8 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">
            Chưa phản hồi <span className="text-muted font-normal">— {list.length} khách đang chờ</span>
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Tin nhắn cuối cùng là của khách, TVV chưa trả lời. Sắp theo mức ưu tiên: Hot → Warm → chưa tag → Cold.
            Cờ tự xoá khi TVV rep (sync 15 phút).
          </p>
        </div>
        <AuditDateFilter from={range.from} to={range.to} />
      </div>

      {list.length === 0 ? (
        <EmptyConfigCard
          icon={MessageCircleWarning}
          title="Không có khách nào đang chờ 🎉"
          description="Mọi tin nhắn của khách trong 14 ngày qua đều đã được TVV trả lời."
        />
      ) : (
        <div className="bezel">
          <div className="bezel-inner overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left">
                  <th className="px-5 py-3 eyebrow">Khách</th>
                  <th className="px-5 py-3 eyebrow">Phân loại</th>
                  <th className="px-5 py-3 eyebrow">Contact</th>
                  <th className="px-5 py-3 eyebrow">Chờ từ</th>
                  <th className="px-5 py-3 eyebrow text-right">Tổng chats</th>
                </tr>
              </thead>
              <tbody>
                {hotFirst.map((l) => {
                  const c = LIFECYCLE_CHIP[l.lifecycle];
                  return (
                    <tr key={l.lead_id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-subtle/50">
                      <td className="px-5 py-3 font-semibold whitespace-nowrap">{l.name}</td>
                      <td className="px-5 py-3"><Chip variant={c.variant}>{c.label}</Chip></td>
                      <td className="px-5 py-3 text-muted whitespace-nowrap tabular-nums">{l.phone || l.email || "—"}</td>
                      <td className="px-5 py-3 whitespace-nowrap tabular-nums font-medium text-[var(--hot)]">
                        {formatRelativeVi(new Date(l.lastActivity))}
                      </td>
                      <td className="px-5 py-3 text-right text-muted tabular-nums">{l.totalChats}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
