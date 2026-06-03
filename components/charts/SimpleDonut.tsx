type Segment = { name: string; value: number; color: string };

/**
 * Pure SVG donut chart — no external lib, server-renderable.
 * Renders 4 colored arcs proportional to values + center total.
 */
export function SimpleDonut({ data, size = 180 }: { data: Segment[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = size / 2 - 20;
  const stroke = 26;
  const circ = 2 * Math.PI * radius;

  let cumPct = 0;
  const segments = data.map((d) => {
    const pct = total ? d.value / total : 0;
    const dashArray = `${pct * circ} ${circ}`;
    const rotate = -90 + cumPct * 360;
    cumPct += pct;
    return { ...d, pct, dashArray, rotate };
  });

  return (
    <div className="flex items-center gap-6">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* background ring */}
          <circle cx={size / 2} cy={size / 2} r={radius} stroke="#f5f5f7" strokeWidth={stroke} fill="none" />
          {segments.map((s) => s.pct > 0 && (
            <circle
              key={s.name}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={s.color}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={s.dashArray}
              transform={`rotate(${s.rotate} ${size / 2} ${size / 2})`}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[22px] font-semibold tabular-nums">
            {total.toLocaleString("vi-VN")}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-2">tổng</div>
        </div>
      </div>
      <div className="flex-1 space-y-2.5">
        {segments.map((s) => (
          <div key={s.name} className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="text-[13px] font-medium flex-1 truncate">{s.name}</span>
            <span className="text-[13px] tabular-nums text-muted">
              {s.value.toLocaleString("vi-VN")}
            </span>
            <span className="text-[11px] tabular-nums text-muted-2 w-10 text-right">
              {(s.pct * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
