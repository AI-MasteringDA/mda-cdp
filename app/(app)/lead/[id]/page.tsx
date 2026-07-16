import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { LeadProfileHeader } from "@/components/LeadProfileHeader";
import { LeadSignalCards } from "@/components/LeadSignalCards";
import { LeadActivityHeatmap } from "@/components/LeadActivityHeatmap";
import { LeadIdentityCard } from "@/components/LeadIdentityCard";
import { LeadDetailTabs } from "@/components/LeadDetailTabs";
import { AiInsightsPanel } from "@/components/AiInsightsPanel";
import { getLeadById, getLeadPercentile } from "@/lib/supabase/queries";
import { getCached, cacheKey } from "@/lib/ai/cache";
import type { LeadInsight } from "@/lib/ai/claude";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [lead, cachedInsight] = await Promise.all([
    getLeadById(id),
    getCached<LeadInsight>(cacheKey.leadInsights(id)),
  ]);
  if (!lead) notFound();

  const percentile = await getLeadPercentile(lead.score);
  const initialInsight = cachedInsight?.payload ?? null;
  const initialGeneratedAt = (cachedInsight?.metadata?.generated_at as string | undefined) ?? null;

  return (
    <>
      <Topbar title="Hồ sơ khách hàng 360°" />

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

        <LeadProfileHeader lead={lead} />

        <div className="mt-6">
          <LeadSignalCards lead={lead} percentile={percentile} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="space-y-6 lg:col-span-2">
            <LeadActivityHeatmap touchpoints={lead.touchpoints} />
            <LeadDetailTabs lead={lead} />
          </section>

          <aside className="space-y-6 lg:col-span-1" id="ai-insights">
            <AiInsightsPanel
              leadId={lead.id}
              initialInsight={initialInsight}
              initialGeneratedAt={initialGeneratedAt}
            />
            <LeadIdentityCard lead={lead} />
          </aside>
        </div>
      </main>
    </>
  );
}
