import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function KPICard({
  label,
  value,
  unit,
  deltaPct,
  deltaPositive,
  deltaLabel = "so với tuần trước",
}: {
  label: string;
  value: number | string;
  unit?: string;
  deltaPct?: number;
  deltaPositive?: boolean;
  deltaLabel?: string;
}) {
  return (
    <div className="hairline rounded-2xl bg-white p-6">
      <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <div className="text-[32px] font-semibold tracking-tight tabular-nums">
          {value}
        </div>
        {unit && <div className="text-base text-muted">{unit}</div>}
      </div>
      {deltaPct !== undefined && (
        <div className="mt-2 flex items-center gap-1">
          {deltaPositive ? (
            <TrendingUp className="h-3.5 w-3.5 text-[var(--success)]" strokeWidth={2} />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-[var(--hot)]" strokeWidth={2} />
          )}
          <span
            className={cn(
              "text-[12px] font-medium tabular-nums",
              deltaPositive ? "text-[var(--success)]" : "text-[var(--hot)]"
            )}
          >
            {deltaPositive ? "+" : "−"}
            {Math.abs(deltaPct)}%
          </span>
          <span className="text-[12px] text-muted-2">{deltaLabel}</span>
        </div>
      )}
    </div>
  );
}
