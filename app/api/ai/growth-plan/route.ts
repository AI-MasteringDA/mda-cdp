import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateGrowthPlan, type GrowthContext, type GrowthPlan } from "@/lib/ai/growth-plan";
import { getCached, setCached, clearCached, cacheKey } from "@/lib/ai/cache";
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
// Haiku 4.5 usually < 20s; bump to 60s for safety.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  const key = cacheKey.growthPlan();

  // Try cache unless force=true
  if (!force) {
    const cached = await getCached<GrowthPlan>(key);
    if (cached) {
      return NextResponse.json({
        plan: cached.payload,
        cached: true,
        generated_at: cached.metadata.generated_at,
        elapsed_seconds: cached.metadata.elapsed_seconds,
      });
    }
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

    const startTime = Date.now();
    console.log(`[Growth Plan] Starting Claude analysis (force=${force})...`);
    const plan = await generateGrowthPlan(ctx);
    const elapsed = Number(((Date.now() - startTime) / 1000).toFixed(1));
    console.log(`[Growth Plan] ✅ Completed in ${elapsed}s`);

    // Cache the result for next time (until user clicks refresh)
    await setCached(key, plan, {
      model: "claude-haiku-4-5",
      elapsed_seconds: elapsed,
      context_summary: { total_leads: ctx.total_leads, total_students: ctx.total_students },
    });

    return NextResponse.json({
      plan,
      cached: false,
      generated_at: new Date().toISOString(),
      context_summary: { total_leads: ctx.total_leads, total_students: ctx.total_students },
      elapsed_seconds: elapsed,
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[Growth Plan] Error:", msg);
    return NextResponse.json({ error: msg.slice(0, 500) }, { status: 500 });
  }
}

// DELETE → clear cache (force fresh on next GET)
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearCached(cacheKey.growthPlan());
  return NextResponse.json({ ok: true });
}
