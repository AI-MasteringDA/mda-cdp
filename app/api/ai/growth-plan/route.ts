import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateGrowthPlan, type GrowthContext } from "@/lib/ai/growth-plan";
import {
  getAllLeadsCount,
  getConversionBySource,
  getSourceDistribution,
  getSmaxChannelBreakdown,
  getTierDistribution,
  getStageDistribution,
  getCohortByMonth,
  getEngagementSegments,
  getTvvPerformance,
  getConversionFunnel,
  getStaleLeadsCount,
} from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all required data in parallel
    const [
      totalLeads,
      bySource,
      sourceDist,
      smaxChannels,
      tiers,
      stages,
      cohorts,
      engagementBuckets,
      tvv,
      funnel,
      staleCnt,
    ] = await Promise.all([
      getAllLeadsCount(),
      getConversionBySource(),
      getSourceDistribution(),
      getSmaxChannelBreakdown(),
      getTierDistribution(),
      getStageDistribution(),
      getCohortByMonth(),
      getEngagementSegments(),
      getTvvPerformance(),
      getConversionFunnel(),
      getStaleLeadsCount(30),
    ]);

    // Compute funnel with drop-rate
    const funnelWithDrop = funnel.map((f, i) => ({
      stage: f.stage,
      count: f.count,
      drop_pct_from_prev:
        i > 0 && funnel[i - 1].count > 0
          ? Number(((1 - f.count / funnel[i - 1].count) * 100).toFixed(1))
          : null,
    }));

    // Recent activity (last 30d)
    const dayAgo = new Date(Date.now() - 30 * 24 * 3600_000);
    const { count: recentNewLeads } = await supabase
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "lead_created")
      .gte("occurred_at", dayAgo.toISOString());
    const { count: recentConversions } = await supabase
      .from("fact_touchpoint")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "conversion")
      .gte("occurred_at", dayAgo.toISOString());

    const totalStudents = bySource.reduce((s, x) => s + x.converted, 0);

    // Merge bySource + sourceDist for touchpoint count
    const tpBySource = new Map(sourceDist.map((s) => [s.name.toLowerCase(), s.touchpoints]));

    const ctx: GrowthContext = {
      total_leads: totalLeads,
      total_students: totalStudents,
      overall_conversion_rate_pct: totalLeads > 0 ? Number((totalStudents / totalLeads * 100).toFixed(2)) : 0,
      tier_distribution: tiers.map((t) => ({ name: t.name, count: t.value })),
      funnel: funnelWithDrop,
      source_breakdown: bySource.map((s) => ({
        source: s.source,
        leads: s.total,
        students: s.converted,
        conversion_rate_pct: s.rate,
        touchpoints: tpBySource.get(s.source) ?? 0,
      })),
      smax_channels: smaxChannels.map((c) => ({
        page_pid: "",
        label: c.label,
        touchpoints: c.touchpoints,
      })),
      stage_distribution: stages.map((s) => ({ stage: s.stage, count: s.count })),
      cohorts: cohorts.map((c) => ({
        month: c.month,
        total: c.total,
        engaged: c.engaged,
        converted: c.converted,
        engagement_rate_pct: c.engagementRate,
        conversion_rate_pct: c.conversionRate,
      })),
      engagement_buckets: engagementBuckets.map((b) => ({ label: b.label, count: b.count })),
      tvv_top: tvv.map((t) => ({
        name: t.name,
        lead_count: t.leadCount,
        converted: t.converted,
        conversion_rate_pct: t.conversionRate,
      })),
      hot_leads_count: tiers.find((t) => t.name === "NÓNG")?.value ?? 0,
      stale_leads_30d: staleCnt,
      recent_period_days: 30,
      recent_conversions: recentConversions ?? 0,
      recent_new_leads: recentNewLeads ?? 0,
    };

    const plan = await generateGrowthPlan(ctx);
    return NextResponse.json({ plan, context_summary: { total_leads: ctx.total_leads, total_students: ctx.total_students } });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[Growth Plan] Error:", msg);
    return NextResponse.json({ error: msg.slice(0, 500) }, { status: 500 });
  }
}
