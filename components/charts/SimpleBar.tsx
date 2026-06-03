type Bar = { label: string; value: number; color: string };

/**
 * Pure CSS horizontal bar chart — no SVG, no lib.
 */
export function SimpleBar({ data, valueLabel = "" }: { data: Bar[]; valueLabel?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={d.label}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[12px] font-medium">{d.label}</span>
              <span className="text-[12px] tabular-nums text-muted">
                {d.value.toLocaleString("vi-VN")} {valueLabel}
              </span>
            </div>
            <div className="h-2.5 rounded bg-subtle overflow-hidden">
              <div
                className="h-full rounded transition-all duration-700"
                style={{ width: `${pct}%`, background: d.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
