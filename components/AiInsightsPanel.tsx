"use client";

import { useState, useEffect } from "react";
// useEffect kept for hooks used in loading state component
import {
  Sparkles,
  Phone,
  Mail,
  Gift,
  Clock,
  Archive,
  RefreshCw,
  AlertCircle,
  Wand2,
  TrendingUp,
  AlertTriangle,
  Target,
  MessageSquare,
  FileText,
  Zap,
} from "lucide-react";

type Insight = {
  summary: string;
  engagement_metrics: {
    emails_sent_by_mda: number;
    emails_opened: number;
    open_rate_pct: number;
    emails_clicked: number;
    chats_from_lead: number;
    chats_from_tvv: number;
    attachments_from_lead: number;
    attachments_from_tvv: number;
    calls_logged: number;
    days_since_first_touch: number | null;
    days_since_last_lead_action: number | null;
    days_since_last_mda_action: number | null;
  };
  key_moments: Array<{ date: string; event: string; significance: string }>;
  lead_voice: {
    topics_interested: string[];
    concerns_raised: string[];
    buying_signals: string[];
  };
  mda_nurture: {
    channels_used: string[];
    recent_campaigns: string[];
    responsiveness: "fast" | "moderate" | "slow" | "ignored";
    quality_assessment: string;
  };
  intent_score: "high" | "medium" | "low" | "unclear";
  intent_reasoning: string;
  risk_signals: string[];
  opportunity: string;
  action: "GỌI NGAY" | "EMAIL CÁ NHÂN HÓA" | "GỬI VOUCHER" | "FOLLOW-UP NHẸ" | "ARCHIVE";
  action_reason: string;
  talking_points: Array<{ hook: string; followup: string }>;
};

const ACTION_META: Record<
  Insight["action"],
  { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; bg: string }
> = {
  "GỌI NGAY":            { icon: Phone,   bg: "#ff3b30" },
  "EMAIL CÁ NHÂN HÓA":   { icon: Mail,    bg: "#ff9500" },
  "GỬI VOUCHER":         { icon: Gift,    bg: "#34c759" },
  "FOLLOW-UP NHẸ":       { icon: Clock,   bg: "#5ac8fa" },
  "ARCHIVE":             { icon: Archive, bg: "#8e8e93" },
};

const INTENT_META: Record<Insight["intent_score"], { color: string; label: string }> = {
  high:    { color: "#34c759", label: "Intent CAO" },
  medium:  { color: "#ff9500", label: "Intent VỪA" },
  low:     { color: "#5ac8fa", label: "Intent THẤP" },
  unclear: { color: "#8e8e93", label: "Chưa rõ" },
};

const RESPONSIVENESS_META: Record<Insight["mda_nurture"]["responsiveness"], { color: string; label: string }> = {
  fast:     { color: "#34c759", label: "🟢 Nhanh" },
  moderate: { color: "#ff9500", label: "🟡 Vừa" },
  slow:     { color: "#ff3b30", label: "🔴 Chậm" },
  ignored:  { color: "#dc2626", label: "❌ Bỏ rơi" },
};

export function AiInsightsPanel({
  leadId,
  initialInsight,
  initialGeneratedAt,
}: {
  leadId: string;
  initialInsight?: Insight | null;
  initialGeneratedAt?: string | null;
}) {
  const [insight, setInsight] = useState<Insight | null>(initialInsight ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt ?? null);
  const [cached, setCached] = useState(!!initialInsight);

  async function analyze(force = false) {
    setLoading(true);
    setError(null);
    // Hard timeout 45s — Haiku usually < 10s, anything longer means stuck.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    try {
      const url = force
        ? `/api/ai/lead-insights/${leadId}?force=true`
        : `/api/ai/lead-insights/${leadId}`;
      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setInsight(data.insight);
      setGeneratedAt(data.generated_at ?? new Date().toISOString());
      setCached(!!data.cached);
    } catch (e) {
      const msg = (e as Error).name === "AbortError"
        ? "Timeout 45s — Haiku đáng lẽ phải xong sau 10s. Check Anthropic key có valid không."
        : (e as Error).message;
      setError(msg);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  function formatGeneratedAt(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "vừa xong";
    if (diffMin < 60) return `${diffMin}m trước`;
    if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h trước`;
    return `${Math.floor(diffMin / (60 * 24))}d trước`;
  }

  // EMPTY STATE
  if (!insight && !loading && !error) {
    return (
      <div className="sticky top-20 rounded-2xl bg-surface p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-foreground" strokeWidth={1.75} />
          <h3 className="text-[14px] font-semibold tracking-tight">AI Insights</h3>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-2 font-medium">
            Claude Haiku 4.5
          </span>
        </div>

        <p className="mt-3 text-[12px] text-muted leading-relaxed">
          Claude sẽ đọc <strong>toàn bộ timeline + metrics chính xác</strong> → phân tích sâu:
          tóm tắt 360°, key moments, voice của lead, đánh giá nỗ lực MDA, intent score, risks, opportunity, 3 talking points cụ thể có quote thật.
        </p>

        <button
          onClick={() => analyze(false)}
          className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <Wand2 className="h-4 w-4" strokeWidth={2} />
          Phân tích sâu
        </button>

        <div className="mt-3 text-[10px] text-muted-2 text-center leading-relaxed">
          ~5 giây · chi phí ~50đ / lần · cache vĩnh viễn cho đến khi click Refresh
        </div>
      </div>
    );
  }

  // LOADING STATE
  if (loading) {
    return <LoadingState />;
  }

  // ERROR
  if (error) {
    return (
      <div className="sticky top-20 rounded-2xl bg-surface p-5">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-[#ff3b30]" strokeWidth={1.75} />
          <h3 className="text-[14px] font-semibold tracking-tight">Lỗi AI</h3>
        </div>
        <p className="mt-3 text-[12px] text-muted leading-relaxed break-words">{error}</p>
        <button
          onClick={() => analyze(false)}
          className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] hover:underline"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          Thử lại
        </button>
      </div>
    );
  }

  if (!insight) return null;
  const ActionIcon = ACTION_META[insight.action].icon;
  const intent = INTENT_META[insight.intent_score];
  const resp = RESPONSIVENESS_META[insight.mda_nurture.responsiveness];
  const m = insight.engagement_metrics;

  return (
    <div className="rounded-2xl bg-surface p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-foreground" strokeWidth={1.75} />
        <h3 className="text-[14px] font-semibold tracking-tight">AI Insights</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">
          Haiku 4.5
        </span>
        <button
          onClick={() => analyze(true)}
          title="Phân tích lại (regen, tốn token)"
          className="ml-auto rounded p-1 text-muted-2 hover:bg-white hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      {generatedAt && (
        <div className="text-[10px] text-muted-2 -mt-3">
          {cached ? "💾 cached" : "✨ vừa gen"} · {formatGeneratedAt(generatedAt)}
        </div>
      )}

      {/* Summary */}
      <p className="text-[13px] leading-relaxed text-foreground">{insight.summary}</p>

      {/* PRIMARY ACTION CTA */}
      <div
        className="flex items-center gap-2.5 rounded-xl px-4 py-3"
        style={{ background: ACTION_META[insight.action].bg }}
      >
        <ActionIcon className="h-5 w-5 text-white shrink-0" strokeWidth={2} />
        <div className="min-w-0">
          <div className="text-[13px] font-bold uppercase tracking-wider text-white">
            {insight.action}
          </div>
          <div className="text-[11px] text-white/95 leading-snug mt-0.5">
            {insight.action_reason}
          </div>
        </div>
      </div>

      {/* Intent + Responsiveness chips */}
      <div className="flex flex-wrap gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
          style={{ background: intent.color }}
        >
          <Zap className="h-3 w-3" strokeWidth={2} />
          {intent.label}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
          style={{ background: resp.color }}
        >
          MDA: {resp.label}
        </span>
      </div>
      <p className="text-[12px] text-muted leading-relaxed -mt-3">{insight.intent_reasoning}</p>

      {/* ENGAGEMENT METRICS */}
      <Section title="📊 Engagement metrics">
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Lead chat" value={m.chats_from_lead} accent={m.chats_from_lead > 0 ? "success" : "muted"} />
          <MetricCard label="TVV chat" value={m.chats_from_tvv} accent="muted" />
          <MetricCard label="MDA email" value={m.emails_sent_by_mda} accent="muted" />
          <MetricCard
            label="Mở mail"
            value={`${m.emails_opened} (${m.open_rate_pct.toFixed(0)}%)`}
            accent={m.emails_opened > 0 ? "success" : "muted"}
          />
          <MetricCard label="Lead gửi file" value={m.attachments_from_lead} accent={m.attachments_from_lead > 0 ? "success" : "muted"} />
          <MetricCard label="Calls" value={m.calls_logged} accent="muted" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted">
          <span>📅 Từ touch đầu: <strong>{m.days_since_first_touch ?? "—"}d</strong></span>
          <span>👤 LEAD silent: <strong>{m.days_since_last_lead_action ?? "∞"}d</strong></span>
        </div>
      </Section>

      {/* KEY MOMENTS */}
      {insight.key_moments.length > 0 && (
        <Section title="🕐 Khoảnh khắc quan trọng">
          <div className="space-y-2.5">
            {insight.key_moments.map((km, i) => (
              <div key={i} className="border-l-2 border-foreground pl-3 py-0.5">
                <div className="text-[11px] text-muted-2 font-mono">{km.date}</div>
                <div className="text-[12px] font-medium text-foreground">{km.event}</div>
                <div className="text-[11px] text-muted italic">→ {km.significance}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* LEAD VOICE */}
      {(insight.lead_voice.topics_interested.length > 0 ||
        insight.lead_voice.concerns_raised.length > 0 ||
        insight.lead_voice.buying_signals.length > 0) && (
        <Section title="👤 Tiếng nói của lead">
          {insight.lead_voice.buying_signals.length > 0 && (
            <SubSection icon={Target} label="Buying signals" color="#34c759">
              <BulletList items={insight.lead_voice.buying_signals} />
            </SubSection>
          )}
          {insight.lead_voice.topics_interested.length > 0 && (
            <SubSection icon={MessageSquare} label="Quan tâm" color="#0064d0">
              <BulletList items={insight.lead_voice.topics_interested} />
            </SubSection>
          )}
          {insight.lead_voice.concerns_raised.length > 0 && (
            <SubSection icon={AlertTriangle} label="Hesitation/Concern" color="#ff9500">
              <BulletList items={insight.lead_voice.concerns_raised} />
            </SubSection>
          )}
        </Section>
      )}

      {/* MDA NURTURE */}
      <Section title="💼 Nỗ lực MDA">
        <p className="text-[12px] text-foreground leading-relaxed mb-2">
          {insight.mda_nurture.quality_assessment}
        </p>
        {insight.mda_nurture.channels_used.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {insight.mda_nurture.channels_used.map((c) => (
              <span key={c} className="rounded-full bg-subtle px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium">
                {c}
              </span>
            ))}
          </div>
        )}
        {insight.mda_nurture.recent_campaigns.length > 0 && (
          <SubSection icon={FileText} label="Campaign gần đây" color="#8e8e93">
            <BulletList items={insight.mda_nurture.recent_campaigns} />
          </SubSection>
        )}
      </Section>

      {/* RISKS */}
      {insight.risk_signals.length > 0 && (
        <Section title="⚠️ Rủi ro">
          <div className="rounded-lg bg-[#fef2f2] p-3">
            <BulletList items={insight.risk_signals} color="#dc2626" />
          </div>
        </Section>
      )}

      {/* OPPORTUNITY */}
      {insight.opportunity && (
        <Section title="🎯 Cơ hội">
          <div className="rounded-lg bg-[#f0fdf4] p-3">
            <div className="flex items-start gap-2">
              <TrendingUp className="h-4 w-4 text-[#15803d] shrink-0 mt-0.5" strokeWidth={1.75} />
              <p className="text-[12px] text-[#15803d] leading-relaxed">{insight.opportunity}</p>
            </div>
          </div>
        </Section>
      )}

      {/* TALKING POINTS */}
      {insight.talking_points.length > 0 && (
        <Section title="🗣 Talking points khi gọi/email">
          <div className="space-y-3">
            {insight.talking_points.map((tp, i) => (
              <div key={i} className="rounded-xl bg-white p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-2 font-semibold mb-1">
                  Hook #{i + 1}
                </div>
                <p className="text-[12px] text-foreground italic mb-2">&ldquo;{tp.hook}&rdquo;</p>
                <div className="text-[10px] uppercase tracking-wider text-muted-2 font-semibold mb-1 mt-2 pt-2 border-t border-[var(--border-subtle)]">
                  Follow-up
                </div>
                <p className="text-[12px] text-muted italic">&ldquo;{tp.followup}&rdquo;</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="text-[10px] text-muted-2 text-right pt-2 border-t border-[var(--border-subtle)]">
        Powered by Claude Haiku 4.5
      </div>
    </div>
  );
}

const LOADING_STEPS = [
  "📥 Đọc timeline + metrics...",
  "🔍 Phân tích buying signals...",
  "🎯 Đánh giá intent & risks...",
  "💡 Sinh talking points cụ thể...",
  "✨ Tổng hợp insights...",
];

function LoadingState() {
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const stepTimer = setInterval(() => {
      setStepIdx((i) => (i + 1) % LOADING_STEPS.length);
    }, 2500);
    const elapsedTimer = setInterval(() => {
      setElapsed((e) => e + 1);
    }, 1000);
    return () => {
      clearInterval(stepTimer);
      clearInterval(elapsedTimer);
    };
  }, []);

  return (
    <div className="sticky top-20 rounded-2xl bg-surface p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-foreground animate-pulse" strokeWidth={1.75} />
        <h3 className="text-[14px] font-semibold tracking-tight">Claude Haiku 4.5 đang phân tích...</h3>
        <span className="ml-auto text-[10px] font-mono tabular-nums text-muted-2">
          {elapsed}s
        </span>
      </div>

      <div className="mt-3 text-[12px] text-foreground font-medium">
        {LOADING_STEPS[stepIdx]}
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/50">
        <div
          className="h-full rounded-full bg-foreground transition-all duration-500"
          style={{ width: `${Math.min((elapsed / 18) * 100, 95)}%` }}
        />
      </div>

      <div className="mt-5 space-y-2.5">
        <div className="h-3 w-3/4 rounded bg-white/70 animate-pulse"></div>
        <div className="h-3 w-full rounded bg-white/70 animate-pulse"></div>
        <div className="h-3 w-2/3 rounded bg-white/70 animate-pulse"></div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="h-12 rounded-lg bg-white/70 animate-pulse"></div>
          <div className="h-12 rounded-lg bg-white/70 animate-pulse" style={{ animationDelay: "150ms" }}></div>
          <div className="h-12 rounded-lg bg-white/70 animate-pulse" style={{ animationDelay: "300ms" }}></div>
          <div className="h-12 rounded-lg bg-white/70 animate-pulse" style={{ animationDelay: "450ms" }}></div>
        </div>
        <div className="mt-4 h-9 w-full rounded-lg bg-white/70 animate-pulse"></div>
      </div>

      <div className="mt-4 text-[10px] text-muted-2 text-center leading-relaxed">
        Haiku 4.5 deep analysis · thường mất 15-20s
        {elapsed > 25 && (
          <div className="mt-1 text-[var(--warm)]">⚠️ Chậm hơn bình thường — đợi hoặc refresh sau</div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-2 font-semibold mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function SubSection({
  icon: Icon,
  label,
  color,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3" style={{ color }} strokeWidth={2} />
        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color }}>
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: "success" | "muted";
}) {
  return (
    <div className={`rounded-lg p-2.5 ${accent === "success" ? "bg-[#f0fdf4]" : "bg-white"}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">{label}</div>
      <div className={`mt-0.5 text-[16px] font-bold tabular-nums ${accent === "success" ? "text-[#15803d]" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function BulletList({ items, color }: { items: string[]; color?: string }) {
  return (
    <ul className="space-y-1">
      {items.map((s, i) => (
        <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed" style={color ? { color } : undefined}>
          <span className="shrink-0" style={color ? { color } : { color: "var(--text-muted-2)" }}>·</span>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}
