"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Calendar } from "lucide-react";

const RANGES = [
  { id: "7d",  label: "7 ngày" },
  { id: "30d", label: "30 ngày" },
  { id: "90d", label: "90 ngày" },
  { id: "ytd", label: "Từ đầu năm" },
  { id: "all", label: "Tất cả" },
] as const;

export type DateRangeId = typeof RANGES[number]["id"];

export function DateRangeFilter({ value }: { value: DateRangeId }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setRange(id: DateRangeId) {
    const p = new URLSearchParams(params.toString());
    if (id === "30d") p.delete("range");
    else p.set("range", id);
    const qs = p.toString();
    router.push(`${pathname}${qs ? "?" + qs : ""}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-2" strokeWidth={1.75} />
      <div className="flex gap-0.5 rounded-lg bg-subtle p-0.5">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
              value === r.id
                ? "bg-white shadow-sm text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Parse range param → from/to Date pair */
export function parseRange(rangeId: string | undefined): { from: Date; to: Date; id: DateRangeId } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setHours(0, 0, 0, 0);
  const id = (rangeId || "30d") as DateRangeId;
  switch (id) {
    case "7d":  from.setDate(from.getDate() - 7); break;
    case "30d": from.setDate(from.getDate() - 30); break;
    case "90d": from.setDate(from.getDate() - 90); break;
    case "ytd": from.setMonth(0, 1); break;
    case "all": from.setFullYear(2020); break;
    default:    from.setDate(from.getDate() - 30);
  }
  return { from, to, id: RANGES.some((r) => r.id === id) ? id : "30d" };
}
