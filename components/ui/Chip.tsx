import { cn } from "@/lib/utils";

type Variant = "default" | "hot" | "cold" | "warm" | "success" | "outline";

const VARIANTS: Record<Variant, string> = {
  default: "bg-subtle text-foreground",
  hot: "bg-[#ff3b30] text-white",
  cold: "bg-[#8e8e93] text-white",
  warm: "bg-[#ff9500] text-white",
  success: "bg-[#34c759] text-white",
  outline: "bg-white text-muted border border-[var(--border-subtle)]",
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

export function ScoreBadge({
  score,
  variant,
}: {
  score: number;
  variant: "hot" | "cold";
}) {
  const bg = variant === "hot" ? "#ff3b30" : "#8e8e93";
  return (
    <div
      className="inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-sm font-semibold text-white tabular-nums"
      style={{ background: bg, minWidth: 44 }}
    >
      {score}
    </div>
  );
}
