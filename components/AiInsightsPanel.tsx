"use client";

import { useEffect, useState } from "react";
import { Sparkles, Phone, Mail, Gift, Clock, Archive, RefreshCw, AlertCircle } from "lucide-react";

type Insight = {
  summary: string;
  insights: string[];
  action: "GỌI NGAY" | "EMAIL CÁ NHÂN HÓA" | "GỬI VOUCHER" | "FOLLOW-UP NHẸ" | "ARCHIVE";
  action_reason: string;
  talking_points: string[];
};

const ACTION_META: Record<
  Insight["action"],
  { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; color: string; bg: string }
> = {
  "GỌI NGAY":            { icon: Phone,   color: "#fff", bg: "#ff3b30" },
  "EMAIL CÁ NHÂN HÓA":   { icon: Mail,    color: "#fff", bg: "#ff9500" },
  "GỬI VOUCHER":         { icon: Gift,    color: "#fff", bg: "#34c759" },
  "FOLLOW-UP NHẸ":       { icon: Clock,   color: "#fff", bg: "#5ac8fa" },
  "ARCHIVE":             { icon: Archive, color: "#fff", bg: "#8e8e93" },
};

export function AiInsightsPanel({ leadId }: { leadId: string }) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/lead-insights/${leadId}${force ? "?refresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setInsight(data.insight);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  if (loading) {
    return (
      <div className="sticky top-20 rounded-2xl bg-surface p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-foreground animate-pulse" strokeWidth={1.75} />
          <h3 className="text-[14px] font-semibold tracking-tight">Claude đang phân tích...</h3>
        </div>
        <div className="mt-5 space-y-2.5">
          <div className="h-3 w-3/4 rounded bg-white/70 animate-pulse"></div>
          <div className="h-3 w-full rounded bg-white/70 animate-pulse"></div>
          <div className="h-3 w-2/3 rounded bg-white/70 animate-pulse"></div>
          <div className="mt-4 h-9 w-full rounded-lg bg-white/70 animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sticky top-20 rounded-2xl bg-surface p-5">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-[#ff3b30]" strokeWidth={1.75} />
          <h3 className="text-[14px] font-semibold tracking-tight">Lỗi AI</h3>
        </div>
        <p className="mt-3 text-[12px] text-muted leading-relaxed">{error}</p>
        <button
          onClick={() => load(true)}
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

  return (
    <div className="sticky top-20 rounded-2xl bg-surface p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-foreground" strokeWidth={1.75} />
        <h3 className="text-[14px] font-semibold tracking-tight">AI Insights</h3>
        <button
          onClick={() => load(true)}
          title="Refresh"
          className="ml-auto rounded p-1 text-muted-2 hover:bg-white hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {/* Summary */}
      <p className="mt-3 text-[13px] leading-relaxed text-foreground">
        {insight.summary}
      </p>

      {/* Suggested action — primary CTA */}
      <div
        className="mt-4 flex items-center gap-2.5 rounded-lg px-3 py-2.5"
        style={{ background: ACTION_META[insight.action].bg }}
      >
        <ActionIcon className="h-4 w-4 text-white shrink-0" strokeWidth={2} />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-white">
            {insight.action}
          </div>
          <div className="text-[11px] text-white/90 leading-snug mt-0.5">
            {insight.action_reason}
          </div>
        </div>
      </div>

      {/* Insights */}
      {insight.insights.length > 0 && (
        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium mb-2">
            Phát hiện
          </div>
          <ul className="space-y-1.5">
            {insight.insights.map((s, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-muted leading-relaxed">
                <span className="text-muted-2 shrink-0">·</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Talking points */}
      {insight.talking_points.length > 0 && (
        <div className="mt-5 rounded-xl bg-white p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium mb-2">
            Điểm nói khi gọi/email
          </div>
          <ul className="space-y-1.5">
            {insight.talking_points.map((s, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-foreground leading-relaxed">
                <span className="font-medium text-muted-2 shrink-0">{i + 1}.</span>
                <span>"{s}"</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 text-[10px] text-muted-2 text-right">
        Powered by Claude Haiku 4.5
      </div>
    </div>
  );
}
