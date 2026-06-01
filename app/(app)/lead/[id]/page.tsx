import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Sparkles, Lock } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, ScoreBadge } from "@/components/ui/Chip";
import { Timeline } from "@/components/Timeline";
import { getLeadById } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await getLeadById(id);
  if (!lead) notFound();

  return (
    <>
      <Topbar title="Hồ sơ học viên" />

      <main className="mx-auto max-w-[1280px] px-8 py-6">
        <nav className="mb-4 flex items-center gap-1.5 text-[12px] text-muted">
          <Link href="/dashboard" className="hover:text-foreground">
            Tổng quan
          </Link>
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
          <Link href="/leads" className="hover:text-foreground">
            Tất cả lead
          </Link>
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
          <span className="text-foreground">{lead.name}</span>
        </nav>

        <header className="hairline rounded-2xl bg-white p-6">
          <div className="flex items-start gap-5">
            <Avatar name={lead.name} color={lead.avatarColor} size={64} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-[24px] font-semibold tracking-tight">
                  {lead.name}
                </h1>
                <Chip variant="outline">{lead.stage}</Chip>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                <span>{lead.email}</span>
                <span className="text-muted-2">·</span>
                <span>{lead.phone}</span>
                <span className="text-muted-2">·</span>
                <span>Nguồn: {lead.source}</span>
                <span className="text-muted-2">·</span>
                <span>TVV phụ trách: {lead.assignee}</span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">
                    Điểm nóng
                  </div>
                  <div className="mt-1">
                    <ScoreBadge score={lead.hotScore} variant="hot" />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">
                    Điểm nguội
                  </div>
                  <div className="mt-1">
                    <ScoreBadge score={lead.coldScore} variant="cold" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {lead.hotReasons.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] pt-4">
              <span className="text-[11px] uppercase tracking-wider text-muted-2 font-medium mr-2">
                Vì sao nóng
              </span>
              {lead.hotReasons.map((r) => (
                <Chip key={r} variant="outline">
                  {r}
                </Chip>
              ))}
            </div>
          )}
          {lead.coldReasons.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)] pt-4">
              <span className="text-[11px] uppercase tracking-wider text-muted-2 font-medium mr-2">
                Vì sao nguội
              </span>
              {lead.coldReasons.map((r) => (
                <Chip key={r} variant="outline">
                  {r}
                </Chip>
              ))}
            </div>
          )}
        </header>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <div className="mb-4 flex items-center gap-1">
              <button className="rounded-lg px-3 py-1.5 text-[13px] font-medium bg-subtle">
                Timeline
              </button>
              <button className="rounded-lg px-3 py-1.5 text-[13px] text-muted hover:text-foreground">
                Email
              </button>
              <button className="rounded-lg px-3 py-1.5 text-[13px] text-muted hover:text-foreground">
                Chat
              </button>
              <button className="rounded-lg px-3 py-1.5 text-[13px] text-muted hover:text-foreground">
                Thông tin
              </button>
            </div>
            <Timeline touchpoints={lead.touchpoints} />
          </section>

          <aside className="lg:col-span-1">
            <div className="sticky top-20 rounded-2xl bg-surface p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-foreground" strokeWidth={1.75} />
                <h3 className="text-[14px] font-semibold tracking-tight">
                  Gợi ý chăm sóc
                </h3>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-2 font-medium">
                  V3
                </span>
              </div>

              <div className="mt-6 flex flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white">
                  <Lock className="h-5 w-5 text-muted" strokeWidth={1.5} />
                </div>
                <h4 className="mt-3 text-[14px] font-semibold">
                  Chưa cấu hình Claude AI
                </h4>
                <p className="mt-2 text-[12px] text-muted leading-relaxed">
                  Phần này sẽ sinh email/tin nhắn cá nhân hóa dựa hồ sơ 360°
                  + 50 touchpoints gần nhất. Cần ANTHROPIC_API_KEY + template
                  trong DB.
                </p>
                <a
                  href="/templates"
                  className="mt-4 text-[12px] font-medium text-[var(--accent)] hover:underline"
                >
                  Cài đặt Templates AI →
                </a>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
