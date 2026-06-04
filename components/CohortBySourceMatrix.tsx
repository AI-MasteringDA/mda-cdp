"use client";

type Data = {
  sources: string[];
  months: string[];
  matrix: Record<string, Record<string, { total: number; converted: number; conv_rate_pct: number }>>;
};

const SOURCE_LABEL: Record<string, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  web: "Wix",
  other: "Khác",
};

function heatColor(pct: number): string {
  if (pct === 0) return "#f4f4f5";
  if (pct < 1) return "#fef2f2";
  if (pct < 3) return "#fef9c3";
  if (pct < 5) return "#dcfce7";
  if (pct < 10) return "#86efac";
  return "#22c55e";
}

function textColor(pct: number): string {
  return pct >= 5 ? "#15803d" : pct === 0 ? "#a1a1aa" : "#1f2937";
}

export function CohortBySourceMatrix({ data }: { data: Data }) {
  if (data.months.length === 0) {
    return (
      <div className="p-6 text-center text-[13px] text-muted-2">Chưa đủ data cho cohort matrix.</div>
    );
  }

  return (
    <div className="p-3 overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">
            <th className="text-left px-3 py-2 sticky left-0 bg-white">Nguồn</th>
            {data.months.map((m) => (
              <th key={m} className="text-center px-2 py-2 font-mono tabular-nums">{m.slice(2)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.sources.map((src) => {
            const row = data.matrix[src] || {};
            return (
              <tr key={src} className="border-t border-[var(--border-subtle)]">
                <td className="px-3 py-2 font-medium sticky left-0 bg-white">
                  {SOURCE_LABEL[src] || src}
                </td>
                {data.months.map((month) => {
                  const cell = row[month];
                  if (!cell || cell.total === 0) {
                    return (
                      <td key={month} className="text-center px-1 py-1">
                        <div
                          className="mx-auto inline-flex h-9 w-12 items-center justify-center rounded text-[10px] text-muted-2"
                          style={{ background: "#f4f4f5" }}
                          title="Không có lead"
                        >
                          —
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td key={month} className="text-center px-1 py-1">
                      <div
                        className="mx-auto inline-flex h-9 w-12 flex-col items-center justify-center rounded text-[10px]"
                        style={{
                          background: heatColor(cell.conv_rate_pct),
                          color: textColor(cell.conv_rate_pct),
                        }}
                        title={`${SOURCE_LABEL[src] || src} × ${month}: ${cell.total} leads, ${cell.converted} chốt`}
                      >
                        <div className="font-semibold tabular-nums">{cell.conv_rate_pct.toFixed(1)}%</div>
                        <div className="text-[9px] opacity-70 tabular-nums">
                          {cell.converted}/{cell.total}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-2">
        <span>Heatmap: tỷ lệ chuyển đổi theo cohort × source</span>
        <span className="ml-auto flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded" style={{ background: "#fef2f2" }} />
          <span>0-1%</span>
          <span className="inline-block h-3 w-5 rounded ml-2" style={{ background: "#fef9c3" }} />
          <span>1-3%</span>
          <span className="inline-block h-3 w-5 rounded ml-2" style={{ background: "#dcfce7" }} />
          <span>3-5%</span>
          <span className="inline-block h-3 w-5 rounded ml-2" style={{ background: "#22c55e" }} />
          <span>5%+</span>
        </span>
      </div>
    </div>
  );
}
