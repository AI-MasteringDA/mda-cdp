import { TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function KPICard({
  label,
  value,
  unit,
  deltaPct,
  deltaPositive,
  deltaLabel = "so với tuần trước",
  accent,
}: {
  label: string;
  value: number | string;
  unit?: string;
  deltaPct?: number;
  deltaPositive?: boolean;
  deltaLabel?: string;
  accent?: "hot" | "warm" | "success" | "cool";
}) {
  const accentMap = {
    hot: "var(--hot)",
    warm: "var(--warm)",
    success: "var(--success)",
    cool: "var(--cool)",
  };

  return (
    <div className="bezel card-lift group">
      <div className="bezel-inner p-6">
        <div className="flex items-start justify-between mb-5">
          <span className="eyebrow">{label}</span>
          <ArrowUpRight
            className="hover-arrow h-4 w-4 text-muted-2 opacity-50 group-hover:opacity-100"
            strokeWidth={1.5}
          />
        </div>
        <div className="flex items-baseline gap-1.5">
          <div className="gradient-num text-[40px] font-bold tracking-[-0.04em] tabular-nums leading-none">
            {value}
          </div>
          {unit && (
            <div className="text-[20px] font-medium text-muted-2 tabular-nums">
              {unit}
            </div>
          )}
        </div>
        {deltaPct !== undefined ? (
          <div className="mt-4 flex items-center gap-1.5">
            <div
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                deltaPositive
                  ? "bg-[var(--success-soft)] text-[var(--success)]"
                  : "bg-[var(--hot-soft)] text-[var(--hot)]"
              )}
            >
              {deltaPositive ? (
                <TrendingUp className="h-3 w-3" strokeWidth={2} />
              ) : (
                <TrendingDown className="h-3 w-3" strokeWidth={2} />
              )}
              {deltaPositive ? "+" : "−"}{Math.abs(deltaPct)}%
            </div>
            <span className="text-[12px] text-muted-2">{deltaLabel}</span>
          </div>
        ) : (
          <div className="mt-4 text-[12px] text-muted-2">{deltaLabel}</div>
        )}
        {accent && (
          <div
            className="mt-5 h-0.5 rounded-full opacity-60"
            style={{ background: accentMap[accent] }}
          />
        )}
      </div>
    </div>
  );
}
