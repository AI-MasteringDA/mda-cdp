import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, ScoreBadge, TierChip } from "@/components/ui/Chip";
import { LeadDetailTabs } from "@/components/LeadDetailTabs";
import { LeadActionBar } from "@/components/LeadActionBar";
import { AiInsightsPanel } from "@/components/AiInsightsPanel";
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
                {lead.email && <span>{lead.email}</span>}
                {lead.email && lead.phone && <span className="text-muted-2">·</span>}
                {lead.phone && <span>{lead.phone}</span>}
              </div>
              {lead.company && (
                <div className="mt-1 text-[13px] text-muted">
                  🏢 {lead.company}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-2">
                <span>
                  Nguồn:{" "}
                  <span className="font-medium text-foreground">{lead.source}</span>
                  {lead.leadSource && (
                    <span className="ml-1">
                      ({lead.leadSource})
                    </span>
                  )}
                </span>
                {lead.assignee && lead.assignee !== "—" && (
                  <>
                    <span>·</span>
                    <span>
                      TVV phụ trách:{" "}
                      <span className="font-medium text-foreground">{lead.assignee}</span>
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">
                  Điểm tổng / 100
                </div>
                <div className="mt-1 flex items-center gap-2 justify-end">
                  <TierChip tier={lead.tier} />
                  <ScoreBadge score={lead.score} tier={lead.tier} />
                </div>
              </div>
            </div>
          </div>

          {lead.reasons.length > 0 && (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium mb-2">
                Cấu thành điểm
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {lead.reasons.map((r) => (
                  <Chip
                    key={r.label}
                    variant={r.sign === "+" ? "positive" : "negative"}
                  >
                    {r.sign}
                    {r.points} {r.label}
                  </Chip>
                ))}
                <span className="ml-2 text-[11px] text-muted-2">
                  Base 40 {lead.reasons.reduce((s, r) => s + (r.sign === "+" ? r.points : -r.points), 0) >= 0 ? "+" : ""}
                  {lead.reasons.reduce((s, r) => s + (r.sign === "+" ? r.points : -r.points), 0)} = {lead.score}/100
                </span>
              </div>
            </div>
          )}

          <LeadActionBar lead={lead} />
        </header>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <LeadDetailTabs lead={lead} />
          </section>

          <aside className="lg:col-span-1" id="ai-insights">
            <AiInsightsPanel leadId={lead.id} />
          </aside>
        </div>
      </main>
    </>
  );
}
