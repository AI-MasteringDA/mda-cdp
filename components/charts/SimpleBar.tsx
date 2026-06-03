type Bar = { label: string; value: number; color: string };

/**
 * Pure CSS horizontal bar chart — no SVG, no lib.
 */
export function SimpleBar({ data, valueLabel = "" }: { data: Bar[]; valueLabel?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={d.label} className={`anim-fade-up delay-${Math.min(i + 1, 8)}`}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[12px] font-medium">{d.label}</span>
              <span className="text-[12px] tabular-nums text-muted">
                {d.value.toLocaleString("vi-VN")} {valueLabel}
              </span>
            </div>
            <div className="h-2.5 rounded bg-subtle overflow-hidden">
              <div
                className="anim-bar-grow h-full rounded"
                style={{
                  width: `${pct}%`,
                  background: d.color,
                  animationDelay: `${100 + i * 80}ms`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
