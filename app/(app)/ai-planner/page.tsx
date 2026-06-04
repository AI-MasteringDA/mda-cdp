import { Topbar } from "@/components/Topbar";
import { GrowthPlanPanel } from "@/components/GrowthPlanPanel";
import { MetricDefinitionBadge } from "@/components/MetricDefinitionBadge";
import { ATTRIBUTION_RULE, ENROLLED_STUDENT, CAC, LTV } from "@/lib/metrics-config";
import { getCached, cacheKey } from "@/lib/ai/cache";
import type { GrowthPlan } from "@/lib/ai/growth-plan";
import { Sparkles, Database } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AIPlannerPage() {
  // SSR-fetch cached plan so client gets it on first paint (no extra round-trip).
  const cached = await getCached<GrowthPlan>(cacheKey.growthPlan());
  const initialPlan = cached?.payload ?? null;
  const initialGeneratedAt = (cached?.metadata?.generated_at as string | undefined) ?? null;

  return (
    <>
      <Topbar title="AI Planner" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500">
            <Sparkles className="h-6 w-6 text-white" strokeWidth={1.75} />
          </div>
          <div className="flex-1">
            <h1 className="text-[28px] font-semibold tracking-tight">
              AI Growth Planner
            </h1>
            <p className="mt-1 text-[14px] text-muted">
              Claude Sonnet 4.6 đọc toàn bộ growth data → đề xuất giả thuyết tăng trưởng + action plan dựa trên evidence.
              <strong> AI đề xuất, người quyết.</strong>
            </p>
          </div>
        </div>

        {/* Canonical metric definitions banner */}
        <section className="hairline rounded-2xl bg-[#fffbeb] p-5 mb-6">
          <div className="flex items-start gap-3">
            <Database className="h-5 w-5 shrink-0 mt-0.5 text-[#854d0e]" strokeWidth={1.75} />
            <div className="flex-1">
              <h2 className="text-[14px] font-semibold mb-2 text-[#854d0e]">
                Định nghĩa canonical đang áp dụng (click ℹ️ để xem chi tiết)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-[12px] text-[#854d0e]">
                <span className="inline-flex items-center gap-1.5">
                  · <strong>1 học viên</strong>
                  <MetricDefinitionBadge def={ENROLLED_STUDENT} />
                  = conversion_count &gt; 0
                </span>
                <span className="inline-flex items-center gap-1.5">
                  · <strong>Attribution</strong> = {ATTRIBUTION_RULE.current}
                  <span className="text-[10px]">(first-touch)</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  · <strong>CAC</strong>
                  <MetricDefinitionBadge def={CAC} />
                  = CHƯA TÍNH ĐƯỢC (thiếu spend data)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  · <strong>LTV</strong>
                  <MetricDefinitionBadge def={LTV} />
                  = CHƯA TÍNH ĐƯỢC (thiếu revenue)
                </span>
              </div>
              <p className="mt-3 text-[11px] text-[#854d0e] italic leading-relaxed">
                Tất cả AI insights ở dưới neo vào những định nghĩa này. Khi muốn đổi nghĩa: sửa
                {" "}<Link href="https://github.com/AI-MasteringDA/mda-cdp/blob/main/lib/metrics-config.ts" target="_blank" className="underline">
                  lib/metrics-config.ts
                </Link>{" "}— KHÔNG sửa scatter trong từng query.
              </p>
            </div>
          </div>
        </section>

        {/* The real AI panel — initial cached state passed from SSR for instant load */}
        <GrowthPlanPanel initialPlan={initialPlan} initialGeneratedAt={initialGeneratedAt} />
      </main>
    </>
  );
}
