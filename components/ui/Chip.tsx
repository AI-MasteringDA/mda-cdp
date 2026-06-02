import { cn } from "@/lib/utils";
import type { LeadTier } from "@/types/lead";

type Variant = "default" | "hot" | "cold" | "warm" | "cool" | "dormant" | "success" | "outline" | "positive" | "negative";

const VARIANTS: Record<Variant, string> = {
  default: "bg-subtle text-foreground",
  hot: "bg-[#ff3b30] text-white",
  cold: "bg-[#8e8e93] text-white",
  warm: "bg-[#ff9500] text-white",
  cool: "bg-[#5ac8fa] text-white",
  dormant: "bg-[#3a3a3c] text-white",
  success: "bg-[#34c759] text-white",
  outline: "bg-white text-muted border border-[var(--border-subtle)]",
  positive: "bg-[#dcfce7] text-[#166534] border border-[#bbf7d0]",
  negative: "bg-[#fee2e2] text-[#991b1b] border border-[#fecaca]",
};

export const TIER_VARIANT: Record<LeadTier, Variant> = {
  "NÓNG": "hot",
  "ẤM": "warm",
  "MÁT": "cool",
  "NGỦ ĐÔNG": "dormant",
};

export function Chip({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
        VARIANTS[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

const TIER_COLORS: Record<LeadTier, string> = {
  "NÓNG": "#ff3b30",
  "ẤM": "#ff9500",
  "MÁT": "#5ac8fa",
  "NGỦ ĐÔNG": "#3a3a3c",
};

export function ScoreBadge({
  score,
  tier,
}: {
  score: number;
  tier?: LeadTier;
}) {
  const t: LeadTier =
    tier ?? (score >= 70 ? "NÓNG" : score >= 40 ? "ẤM" : score >= 20 ? "MÁT" : "NGỦ ĐÔNG");
  return (
    <div
      className="inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-sm font-semibold text-white tabular-nums"
      style={{ background: TIER_COLORS[t], minWidth: 44 }}
      title={`${score}/100 — ${t}`}
    >
      {score}
    </div>
  );
}

export function TierChip({ tier }: { tier: LeadTier }) {
  return <Chip variant={TIER_VARIANT[tier]}>{tier}</Chip>;
}
