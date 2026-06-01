import { Topbar } from "@/components/Topbar";
import { Chip } from "@/components/ui/Chip";
import { getScoringRules } from "@/lib/supabase/queries";
import { Target, Flame, Snowflake } from "lucide-react";
import { RuleToggle } from "./RuleToggle";
import { RecomputeButton } from "./RecomputeButton";

export const dynamic = "force-dynamic";

const WINDOW_LABEL: Record<string, string> = {
  "24h": "24h",
  "7d": "7 ngày",
  "30d": "30 ngày",
};

export default async function ScoringPage() {
  const rules = await getScoringRules();
  const hotRules = rules.filter((r) => r.variant === "hot");
  const coldRules = rules.filter((r) => r.variant === "cold");

  return (
    <>
      <Topbar title="Điểm số" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">
              Rule chấm điểm
            </h1>
            <p className="mt-1 text-[14px] text-muted">
              Đọc từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">scoring_rule</code>.
              Toggle on/off → bấm "Tính lại scores" → dashboard cập nhật.
            </p>
          </div>
          <RecomputeButton />
        </div>

        <section className="hairline rounded-2xl bg-white">
          <div className="hairline-b flex items-center gap-2 px-6 py-4">
            <Flame className="h-4 w-4 text-[var(--hot)]" strokeWidth={1.75} />
            <h2 className="text-[15px] font-semibold tracking-tight">
              Điểm nóng
            </h2>
            <span className="text-[12px] text-muted">
              · ý định đang tăng, nên gọi ngay
            </span>
          </div>
          {hotRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-start gap-4 border-b border-[var(--border-subtle)] px-6 py-4 last:border-0"
            >
              <Target className="mt-1 h-4 w-4 text-muted" strokeWidth={1.75} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium">{rule.signalLabel}</span>
                  <Chip variant="outline">+{rule.weight} điểm</Chip>
                </div>
                <div className="mt-1 text-[12px] text-muted font-mono">
                  {rule.signal} {rule.operator} {rule.threshold} (trong{" "}
                  {WINDOW_LABEL[rule.window]})
                </div>
              </div>
              <RuleToggle ruleId={rule.id} initial={rule.enabled} />
            </div>
          ))}
        </section>

        <section className="mt-6 hairline rounded-2xl bg-white">
          <div className="hairline-b flex items-center gap-2 px-6 py-4">
            <Snowflake className="h-4 w-4 text-[var(--cold)]" strokeWidth={1.75} />
            <h2 className="text-[15px] font-semibold tracking-tight">
              Điểm nguội
            </h2>
            <span className="text-[12px] text-muted">
              · ý định đang tụt, cứu trước khi mất
            </span>
          </div>
          {coldRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-start gap-4 border-b border-[var(--border-subtle)] px-6 py-4 last:border-0"
            >
              <Target className="mt-1 h-4 w-4 text-muted" strokeWidth={1.75} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium">{rule.signalLabel}</span>
                  <Chip variant="outline">+{rule.weight} điểm</Chip>
                </div>
                <div className="mt-1 text-[12px] text-muted font-mono">
                  {rule.signal} {rule.operator} {rule.threshold} (trong{" "}
                  {WINDOW_LABEL[rule.window]})
                </div>
              </div>
              <RuleToggle ruleId={rule.id} initial={rule.enabled} />
            </div>
          ))}
        </section>

        <section className="mt-6 hairline rounded-2xl bg-surface p-5">
          <p className="text-[12px] text-muted leading-relaxed">
            <strong className="text-foreground">Engine:</strong> SQL function{" "}
            <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">
              recompute_lead_scores()
            </code>{" "}
            đọc các rule đang bật → aggregate{" "}
            <code className="font-mono">fact_touchpoint</code> theo signal/window
            → cộng weight nếu match → cap 100 → UPSERT{" "}
            <code className="font-mono">fact_lead_score</code>. V2 sẽ tự chạy
            mỗi khi có touchpoint mới (trigger).
          </p>
        </section>
      </main>
    </>
  );
}
