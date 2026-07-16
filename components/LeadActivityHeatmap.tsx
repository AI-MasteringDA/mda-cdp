import { Clock } from "lucide-react";
import type { Touchpoint } from "@/types/lead";
import { buildHeatmap, peakWindow, HEATMAP_DAYS, HEATMAP_BUCKETS } from "@/lib/lead-analytics";

/** Heatmap giờ × thứ khách hay tương tác — thay block "Day & hour" của Antsomi. */
export function LeadActivityHeatmap({ touchpoints }: { touchpoints: Touchpoint[] }) {
  const { grid, max, total } = buildHeatmap(touchpoints);
  if (total === 0) return null;
  const peak = peakWindow(touchpoints);

  function cellBg(count: number): string {
    if (count === 0) return "var(--subtle)";
    const intensity = 0.2 + 0.8 * (count / max);
    return `color-mix(in srgb, var(--hot) ${Math.round(intensity * 100)}%, transparent)`;
  }

  return (
    <div className="hairline rounded-2xl bg-white p-5">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
        <Clock className="h-4 w-4 text-muted" strokeWidth={1.75} />
        Giờ khách hay tương tác
      </div>
      {peak && (
        <div className="mb-3 text-[12px] text-muted">
          Sôi nổi nhất: <span className="font-semibold text-foreground">{peak}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="w-8" />
              {HEATMAP_BUCKETS.map((b) => (
                <th key={b} className="px-1 text-[9.5px] font-medium text-muted-2">
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEATMAP_DAYS.map((day, d) => (
              <tr key={day}>
                <td className="pr-1 text-[10.5px] font-medium text-muted-2">{day}</td>
                {grid[d].map((count, b) => (
                  <td key={b}>
                    <div
                      className="h-6 w-9 rounded-[5px]"
                      style={{ background: cellBg(count) }}
                      title={`${day} ${HEATMAP_BUCKETS[b]}: ${count} tương tác`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[10.5px] text-muted-2">
        <span>Ít</span>
        <div className="flex gap-0.5">
          {[0.2, 0.45, 0.7, 1].map((i) => (
            <div
              key={i}
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ background: `color-mix(in srgb, var(--hot) ${Math.round(i * 100)}%, transparent)` }}
            />
          ))}
        </div>
        <span>Nhiều</span>
        <span className="ml-auto">Dựa trên {total} tương tác gần nhất</span>
      </div>
    </div>
  );
}
