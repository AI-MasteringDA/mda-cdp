"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown, Check, Loader2 } from "lucide-react";
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
  // Server component fetch mất vài giây với khoảng dài — useTransition cho biết
  // khi nào dữ liệu mới đang về, và `pending` là khoảng người dùng vừa chọn
  // (khác `from/to` vì props chỉ đổi sau khi server trả xong).
  const [isPending, startTransition] = useTransition();
  const [pendingRange, setPendingRange] = useState<{ f: string; t: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setCustomFrom(from); setCustomTo(to); }, [from, to]);
  // Dữ liệu đã về → bỏ trạng thái chờ
  useEffect(() => { if (!isPending) setPendingRange(null); }, [isPending]);

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
    if (f === from && t === to) { setOpen(false); return; }
    const next = new URLSearchParams(params.toString());
    next.set("from", f);
    next.set("to", t);
    setOpen(false);
    setPendingRange({ f, t });
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  // Trong lúc chờ server, hiển thị khoảng NGƯỜI DÙNG VỪA CHỌN, không phải khoảng cũ
  const shownFrom = pendingRange?.f ?? from;
  const shownTo = pendingRange?.t ?? to;
  const today = isoToday();
  const activePreset = shownTo === today
    ? PRESETS.find((p) => isoDaysAgo(p.days) === shownFrom)?.days
    : undefined;
  const label = activePreset
    ? PRESETS.find((p) => p.days === activePreset)!.label
    : `${fmt(shownFrom)} → ${fmt(shownTo)}`;

  return (
    <div className="relative" ref={boxRef}>
      {/* Thanh tiến trình mảnh chạy ngang phía trên nút khi đang tải */}
      {isPending && (
        <span className="pointer-events-none absolute -top-1.5 left-0 right-0 h-[2px] overflow-hidden rounded-full bg-[var(--border-subtle)]">
          <span className="audit-bar-indeterminate block h-full w-1/3 rounded-full bg-[var(--cool)]" />
        </span>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-busy={isPending}
        className={cn(
          "press flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-medium",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          isPending
            ? "border-[var(--cool)] bg-[color-mix(in_srgb,var(--cool)_8%,transparent)]"
            : "border-[var(--border-subtle)] bg-[var(--background)] hover:bg-subtle"
        )}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--cool)]" strokeWidth={2} />
        ) : (
          <Calendar className="h-4 w-4 text-muted" strokeWidth={1.75} />
        )}
        <span className="tabular-nums">{label}</span>
        {isPending ? (
          <span className="text-[12px] font-semibold text-[var(--cool)]">đang lọc…</span>
        ) : (
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-2 transition-transform", open && "rotate-180")} />
        )}
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
