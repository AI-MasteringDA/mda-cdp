"use client";

type FunnelStage = { stage: string; count: number; color: string };

export function FunnelBar({ data }: { data: FunnelStage[] }) {
  const max = Math.max(...data.map((d) => d.count));
  return (
    <div className="space-y-2.5">
      {data.map((stage, i) => {
        const pct = max ? (stage.count / max * 100) : 0;
        const prevCount = i > 0 ? data[i - 1].count : stage.count;
        const dropPct = i > 0 && prevCount > 0
          ? Number(((1 - stage.count / prevCount) * 100).toFixed(1))
          : 0;
        return (
          <div key={stage.stage}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[13px] font-medium">{stage.stage}</span>
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-semibold tabular-nums">
                  {stage.count.toLocaleString("vi-VN")}
                </span>
                {i > 0 && (
                  <span className="text-[11px] text-muted-2 tabular-nums">
                    −{dropPct}% từ trên
                  </span>
                )}
              </div>
            </div>
            <div className="h-7 rounded-md bg-subtle overflow-hidden">
              <div
                className="h-full rounded-md transition-all duration-500"
                style={{ width: `${pct}%`, background: stage.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
