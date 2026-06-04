"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  Wand2,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  Zap,
  Database,
  Users,
  BarChart3,
  Lightbulb,
  Clock,
} from "lucide-react";

type GrowthPlan = {
  executive_summary: string;
  health_status: "healthy" | "growing" | "concerning" | "critical";
  health_reasoning: string;
  attribution_findings: Array<{ insight: string; evidence: string; business_impact: string }>;
  funnel_findings: Array<{ insight: string; evidence: string; business_impact: string }>;
  segment_findings: Array<{ insight: string; evidence: string; business_impact: string }>;
  hypotheses: Array<{
    hypothesis: string;
    rationale: string;
    test_plan: string;
    expected_impact: "high" | "medium" | "low";
    confidence: "high" | "medium" | "low";
  }>;
  action_items: Array<{
    priority: "P0" | "P1" | "P2";
    action: string;
    owner: string;
    timeline: string;
    expected_outcome: string;
  }>;
  risks: string[];
  data_infrastructure_gaps: string[];
};

const HEALTH_META: Record<GrowthPlan["health_status"], { color: string; label: string; icon: typeof TrendingUp }> = {
  healthy:    { color: "#34c759", label: "🟢 KHỎE MẠNH",  icon: TrendingUp },
  growing:    { color: "#0064d0", label: "🔵 ĐANG TĂNG",  icon: TrendingUp },
  concerning: { color: "#ff9500", label: "🟡 ĐÁNG LO",    icon: AlertTriangle },
  critical:   { color: "#ff3b30", label: "🔴 NGUY HIỂM",  icon: TrendingDown },
};

const PRIORITY_BG: Record<"P0" | "P1" | "P2", string> = {
  P0: "var(--hot)",
  P1: "var(--warm)",
  P2: "var(--accent)",
};

const IMPACT_COLOR = { high: "#34c759", medium: "#ff9500", low: "#5ac8fa" };
const CONFIDENCE_COLOR = { high: "#34c759", medium: "#ff9500", low: "#8e8e93" };

const LOADING_STEPS = [
  "📥 Đọc growth snapshot...",
  "🔍 Phân tích attribution...",
  "📊 Đánh giá funnel & cohorts...",
  "🎯 Phát hiện phân khúc...",
  "💡 Sinh giả thuyết tăng trưởng...",
  "📋 Lập kế hoạch hành động...",
];

export function GrowthPlanPanel() {
  const [plan, setPlan] = useState<GrowthPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/growth-plan");
      const text = await res.text();
      // Try to parse as JSON, but if it's not JSON (e.g., Vercel timeout returns HTML/text)
      // surface a clearer error message
      let data: { plan?: GrowthPlan; error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        // Likely Vercel function error page / timeout / runtime crash
        if (text.toLowerCase().includes("timeout") || text.toLowerCase().includes("an error occurred")) {
          throw new Error(
            `Vercel function timeout (Sonnet 4.6 mất quá lâu). HTTP ${res.status}. ` +
            `Try: refresh sau 30s, hoặc fallback sang Haiku qua env var ANTHROPIC_GROWTH_MODEL=claude-haiku-4-5`
          );
        }
        throw new Error(
          `Server trả về non-JSON (HTTP ${res.status}). First 200 chars: ${text.slice(0, 200)}`
        );
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (!data.plan) throw new Error("Missing plan in response");
      setPlan(data.plan);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // EMPTY
  if (!plan && !loading && !error) {
    return (
      <section className="hairline rounded-2xl bg-white p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500">
            <Lightbulb className="h-6 w-6 text-white" strokeWidth={1.75} />
          </div>
          <div className="flex-1">
            <h2 className="text-[16px] font-semibold tracking-tight">Growth Plan AI</h2>
            <p className="mt-1 text-[13px] text-muted leading-relaxed">
              Claude Sonnet 4.6 sẽ đọc <strong>toàn bộ growth data thật</strong> (attribution, funnel, cohorts, segments, TVV performance) → đề xuất:
            </p>
            <ul className="mt-3 space-y-1 text-[13px] text-muted">
              <li>· 📊 Findings về Attribution / Funnel / Segments (có evidence)</li>
              <li>· 💡 Giả thuyết tăng trưởng để TEST (hypothesis-driven)</li>
              <li>· 📋 Action items P0/P1/P2 với owner + timeline</li>
              <li>· ⚠️ Risks + data gaps cần fix</li>
            </ul>
            <button
              onClick={analyze}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-[13px] font-medium text-white hover:opacity-90"
            >
              <Wand2 className="h-4 w-4" strokeWidth={2} />
              Tạo Growth Plan
            </button>
            <p className="mt-3 text-[11px] text-muted-2">
              ~20-30 giây · chi phí ~3000đ / lần (deep analysis, nhiều context)
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <section className="hairline rounded-2xl bg-white p-6">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="h-4 w-4 text-[var(--hot)]" strokeWidth={1.75} />
          <h3 className="text-[14px] font-semibold tracking-tight">Lỗi AI Growth Plan</h3>
        </div>
        <p className="text-[12px] text-muted leading-relaxed break-words">{error}</p>
        <button
          onClick={analyze}
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          Thử lại
        </button>
      </section>
    );
  }

  if (!plan) return null;
  const health = HEALTH_META[plan.health_status];

  return (
    <div className="space-y-5">
      {/* Header + Health */}
      <section className="hairline rounded-2xl bg-white p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500">
              <Sparkles className="h-5 w-5 text-white" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-semibold tracking-tight">Growth Plan AI</h2>
              <p className="mt-0.5 text-[11px] text-muted-2">Claude Sonnet 4.6 · đọc data thật, neo vào số</p>
            </div>
          </div>
          <button
            onClick={analyze}
            title="Phân tích lại"
            className="press rounded-lg p-2 text-muted-2 hover:bg-subtle hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Health */}
        <div className="flex items-start gap-3 rounded-xl p-4" style={{ background: `${health.color}15`, border: `1px solid ${health.color}40` }}>
          <health.icon className="h-5 w-5 shrink-0 mt-0.5" style={{ color: health.color }} strokeWidth={1.75} />
          <div className="min-w-0">
            <div className="text-[13px] font-bold uppercase tracking-wider" style={{ color: health.color }}>
              {health.label}
            </div>
            <p className="mt-1 text-[12px] text-foreground leading-relaxed">{plan.health_reasoning}</p>
          </div>
        </div>

        {/* Executive summary */}
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-2 font-semibold mb-2">
            Executive Summary
          </div>
          <p className="text-[13px] text-foreground leading-relaxed">{plan.executive_summary}</p>
        </div>
      </section>

      {/* Findings — 3 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <FindingsCard
          title="📊 Attribution Findings"
          icon={BarChart3}
          findings={plan.attribution_findings}
        />
        <FindingsCard
          title="📈 Funnel Findings"
          icon={TrendingDown}
          findings={plan.funnel_findings}
        />
        <FindingsCard
          title="👥 Segment Findings"
          icon={Users}
          findings={plan.segment_findings}
        />
      </div>

      {/* HYPOTHESES — Growth experiments */}
      <section className="hairline rounded-2xl bg-white p-6">
        <h3 className="text-[15px] font-semibold tracking-tight mb-1 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-[var(--warm)]" strokeWidth={1.75} />
          Giả thuyết tăng trưởng để TEST
        </h3>
        <p className="text-[11px] text-muted-2 mb-4">
          Hypothesis-driven growth. Không phải fact — là giả thuyết để bàn + thử nghiệm.
        </p>
        <div className="space-y-3">
          {plan.hypotheses.map((h, i) => (
            <div key={i} className="hairline rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-white text-[11px] font-bold">
                  H{i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-relaxed">{h.hypothesis}</p>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg bg-subtle p-3">
                      <div className="text-[9px] uppercase tracking-wider text-muted-2 font-semibold mb-1">Lý do</div>
                      <p className="text-[11px] text-muted leading-relaxed">{h.rationale}</p>
                    </div>
                    <div className="rounded-lg bg-[#eff6ff] p-3">
                      <div className="text-[9px] uppercase tracking-wider text-[#0064d0] font-semibold mb-1">Test plan</div>
                      <p className="text-[11px] text-[#0064d0] leading-relaxed">{h.test_plan}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                      style={{ background: IMPACT_COLOR[h.expected_impact] }}
                    >
                      Impact: {h.expected_impact.toUpperCase()}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                      style={{ background: CONFIDENCE_COLOR[h.confidence] }}
                    >
                      Confidence: {h.confidence.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ACTION ITEMS */}
      <section className="hairline rounded-2xl bg-white p-6">
        <h3 className="text-[15px] font-semibold tracking-tight mb-1 flex items-center gap-2">
          <Target className="h-4 w-4 text-[var(--hot)]" strokeWidth={1.75} />
          Action Items (sắp xếp priority)
        </h3>
        <p className="text-[11px] text-muted-2 mb-4">
          AI đề xuất, người quyết. Không tự execute — review rồi assign cho owner.
        </p>
        <div className="space-y-2">
          {plan.action_items.map((a, i) => (
            <div key={i} className="hairline flex items-start gap-3 rounded-xl p-3">
              <span
                className="inline-flex h-6 shrink-0 items-center justify-center rounded-md px-2 text-[10px] font-bold uppercase text-white tracking-wider"
                style={{ background: PRIORITY_BG[a.priority] }}
              >
                {a.priority}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium leading-snug">{a.action}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-2">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" strokeWidth={1.75} />
                    {a.owner}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" strokeWidth={1.75} />
                    {a.timeline}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted italic">→ {a.expected_outcome}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* RISKS + DATA GAPS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {plan.risks.length > 0 && (
          <section className="hairline rounded-2xl bg-[#fef2f2] p-6">
            <h3 className="text-[14px] font-semibold tracking-tight mb-3 flex items-center gap-2 text-[var(--hot)]">
              <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
              Rủi ro
            </h3>
            <ul className="space-y-2">
              {plan.risks.map((r, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-foreground leading-relaxed">
                  <span className="text-[var(--hot)] shrink-0">·</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.data_infrastructure_gaps.length > 0 && (
          <section className="hairline rounded-2xl bg-[#eff6ff] p-6">
            <h3 className="text-[14px] font-semibold tracking-tight mb-3 flex items-center gap-2 text-[#0064d0]">
              <Database className="h-4 w-4" strokeWidth={1.75} />
              Data infrastructure cần fix
            </h3>
            <ul className="space-y-2">
              {plan.data_infrastructure_gaps.map((g, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-foreground leading-relaxed">
                  <span className="text-[#0064d0] shrink-0">·</span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="text-[10px] text-muted-2 text-right">Powered by Claude Sonnet 4.6 · neo vào data thật</div>
    </div>
  );
}

function FindingsCard({
  title,
  icon: Icon,
  findings,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  findings: Array<{ insight: string; evidence: string; business_impact: string }>;
}) {
  return (
    <section className="hairline rounded-2xl bg-white p-5">
      <h3 className="text-[13px] font-semibold tracking-tight mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted" strokeWidth={1.75} />
        {title}
      </h3>
      {findings.length === 0 ? (
        <p className="text-[11px] text-muted-2 italic">Không có finding nào nổi bật.</p>
      ) : (
        <div className="space-y-3">
          {findings.map((f, i) => (
            <div key={i}>
              <div className="text-[12px] font-medium text-foreground leading-snug">{f.insight}</div>
              <div className="mt-1 text-[11px] text-muted-2 font-mono leading-relaxed">
                📊 {f.evidence}
              </div>
              <div className="mt-1 text-[11px] text-muted italic leading-relaxed">
                → {f.business_impact}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LoadingState() {
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const stepTimer = setInterval(() => {
      setStepIdx((i) => (i + 1) % LOADING_STEPS.length);
    }, 3000);
    const elapsedTimer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      clearInterval(stepTimer);
      clearInterval(elapsedTimer);
    };
  }, []);

  return (
    <section className="hairline rounded-2xl bg-white p-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-foreground animate-pulse" strokeWidth={1.75} />
        <h3 className="text-[14px] font-semibold tracking-tight">Claude Sonnet 4.6 đang phân tích...</h3>
        <span className="ml-auto text-[11px] font-mono tabular-nums text-muted-2">{elapsed}s</span>
      </div>

      <div className="mb-3 text-[13px] text-foreground font-medium">{LOADING_STEPS[stepIdx]}</div>

      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
        <div
          className="h-full rounded-full bg-foreground transition-all duration-500"
          style={{ width: `${Math.min((elapsed / 30) * 100, 95)}%` }}
        />
      </div>

      <div className="space-y-3">
        <div className="h-3 w-3/4 rounded bg-subtle animate-pulse"></div>
        <div className="h-3 w-full rounded bg-subtle animate-pulse"></div>
        <div className="h-3 w-2/3 rounded bg-subtle animate-pulse"></div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-subtle animate-pulse" style={{ animationDelay: `${i * 150}ms` }}></div>
          ))}
        </div>
      </div>

      <p className="mt-5 text-[10px] text-muted-2 text-center">
        Sonnet 4.6 deep analysis · thường mất 20-30s
        {elapsed > 40 && (
          <span className="block mt-1 text-[var(--warm)]">⚠️ Chậm hơn bình thường — Sonnet có thể đang load nặng</span>
        )}
      </p>
    </section>
  );
}

// Suppress unused warnings for icons
const _unused = { Zap };
void _unused;
