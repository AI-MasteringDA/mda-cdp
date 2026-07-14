"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESETS = [
  { days: 7, label: "7 ngày qua" },
  { days: 14, label: "14 ngày qua" },
  { days: 30, label: "30 ngày qua" },
  { days: 90, label: "3 tháng qua" },
  { days: 180, label: "6 tháng qua" },
  { days: 365, label: "1 năm qua" },
];

function isoToday() {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
function isoDaysAgo(d: number) {
  return new Date(Date.now() + 7 * 3600_000 - d * 86400_000).toISOString().slice(0, 10);
}
function fmt(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

/**
 * Bộ lọc thời gian cho SMAX Audit.
 * Ghi vào URL (?from=YYYY-MM-DD&to=YYYY-MM-DD) → server component đọc lại,
 * nên link share được và F5 vẫn giữ nguyên khoảng đang xem.
 */
export function AuditDateFilter({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setCustomFrom(from); setCustomTo(to); }, [from, to]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const apply = (f: string, t: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("from", f);
    next.set("to", t);
    setOpen(false);
    router.push(`${pathname}?${next.toString()}`);
  };

  // preset nào đang active?
  const today = isoToday();
  const activePreset = to === today
    ? PRESETS.find((p) => isoDaysAgo(p.days) === from)?.days
    : undefined;
  const label = activePreset
    ? PRESETS.find((p) => p.days === activePreset)!.label
    : `${fmt(from)} → ${fmt(to)}`;

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "press flex items-center gap-2 rounded-lg border border-[var(--border-subtle)]",
          "bg-[var(--background)] px-3.5 py-2 text-[13px] font-medium",
          "hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        )}
      >
        <Calendar className="h-4 w-4 text-muted" strokeWidth={1.75} />
        <span className="tabular-nums">{label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-2 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[280px] rounded-xl border border-[var(--border-subtle)] bg-[var(--background)] p-2 shadow-xl">
          <div className="px-2 pb-1.5 pt-1 eyebrow">Khoảng nhanh</div>
          {PRESETS.map((p) => {
            const on = activePreset === p.days;
            return (
              <button
                key={p.days}
                onClick={() => apply(isoDaysAgo(p.days), today)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px]",
                  on ? "bg-subtle font-semibold" : "hover:bg-subtle"
                )}
              >
                {p.label}
                {on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
              </button>
            );
          })}

          <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
            <div className="px-2 pb-2 eyebrow">Tuỳ chọn</div>
            <div className="flex items-center gap-2 px-2">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-[12.5px] tabular-nums"
              />
              <span className="text-muted-2">→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={today}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-[12.5px] tabular-nums"
              />
            </div>
            <button
              onClick={() => apply(customFrom, customTo)}
              disabled={!customFrom || !customTo || customFrom > customTo}
              className="press mt-2 w-full rounded-lg bg-foreground px-3 py-2 text-[13px] font-semibold text-[var(--background)] disabled:opacity-40"
            >
              Áp dụng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
