"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lọc lead theo LẦN TƯƠNG TÁC CUỐI.
 *
 * Cần thiết vì scoring miễn phạt im lặng cho lead Sales tag NÓNG — nên danh
 * sách NÓNG có cả lead im 6-12 tháng. Sales chỉ muốn gọi người còn "sống".
 */

const PRESETS = [
  { days: 3, label: "3 ngày qua" },
  { days: 7, label: "7 ngày qua" },
  { days: 14, label: "14 ngày qua" },
  { days: 30, label: "30 ngày qua" },
  { days: 90, label: "3 tháng qua" },
  { days: 180, label: "6 tháng qua" },
];

const VN = 7 * 3600_000;
const isoToday = () => new Date(Date.now() + VN).toISOString().slice(0, 10);
const isoDaysAgo = (d: number) => new Date(Date.now() + VN - d * 86400_000).toISOString().slice(0, 10);
const fmt = (d: string) => d.split("-").reverse().join("/");

export function LeadActivityFilter({ from, to }: { from?: string; to?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const today = isoToday();
  const [cFrom, setCFrom] = useState(from ?? isoDaysAgo(30));
  const [cTo, setCTo] = useState(to ?? today);
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<{ f?: string; t?: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCFrom(from ?? isoDaysAgo(30));
    setCTo(to ?? today);
  }, [from, to, today]);
  useEffect(() => { if (!isPending) setPending(null); }, [isPending]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const apply = (f?: string, t?: string) => {
    if (f === from && t === to) { setOpen(false); return; }
    const p = new URLSearchParams(params.toString());
    p.delete("page");
    if (f && t) { p.set("from", f); p.set("to", t); }
    else { p.delete("from"); p.delete("to"); }
    setOpen(false);
    setPending({ f, t });
    startTransition(() => router.push(`${pathname}${p.toString() ? "?" + p.toString() : ""}`));
  };

  const shownFrom = pending ? pending.f : from;
  const shownTo = pending ? pending.t : to;
  const activePreset = shownFrom && shownTo === today
    ? PRESETS.find((p) => isoDaysAgo(p.days) === shownFrom)?.days
    : undefined;
  const label = !shownFrom || !shownTo
    ? "Mọi thời điểm"
    : activePreset
      ? PRESETS.find((p) => p.days === activePreset)!.label
      : `${fmt(shownFrom)} → ${fmt(shownTo)}`;
  const isAll = !shownFrom || !shownTo;

  return (
    <div className="relative" ref={box}>
      {isPending && (
        <span className="pointer-events-none absolute -top-1.5 left-0 right-0 h-[2px] overflow-hidden rounded-full bg-[var(--border-subtle)]">
          <span className="audit-bar-indeterminate block h-full w-1/3 rounded-full bg-[var(--cool)]" />
        </span>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-busy={isPending}
        title="Lọc theo mốc nóng gần nhất = mới hơn giữa (tương tác thật cuối) và (lần Sales tag Hot)"
        className={cn(
          "press flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          isPending
            ? "border-[var(--cool)] bg-[color-mix(in_srgb,var(--cool)_8%,transparent)]"
            : isAll
              ? "border-[var(--border-subtle)] text-muted hover:bg-subtle hover:text-foreground"
              : "border-foreground bg-foreground text-[var(--background)]"
        )}
      >
        {isPending
          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--cool)]" strokeWidth={2} />
          : <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} />}
        <span className="tabular-nums">{label}</span>
        {isPending
          ? <span className="text-[12px] font-semibold text-[var(--cool)]">đang lọc…</span>
          : <ChevronDown className={cn("h-3.5 w-3.5 opacity-60 transition-transform", open && "rotate-180")} />}
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-[280px] rounded-xl border border-[var(--border-subtle)] bg-[var(--background)] p-2 shadow-xl">
          <div className="px-2 pb-1.5 pt-1 eyebrow">Nóng gần nhất trong</div>
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
          <button
            onClick={() => apply(undefined, undefined)}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px]",
              isAll ? "bg-subtle font-semibold" : "hover:bg-subtle"
            )}
          >
            Mọi thời điểm
            {isAll && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
          </button>

          <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
            <div className="px-2 pb-2 eyebrow">Tuỳ chọn</div>
            <div className="flex items-center gap-2 px-2">
              <input
                type="date" value={cFrom} max={cTo}
                onChange={(e) => setCFrom(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-[12.5px] tabular-nums"
              />
              <span className="text-muted-2">→</span>
              <input
                type="date" value={cTo} min={cFrom} max={today}
                onChange={(e) => setCTo(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-[12.5px] tabular-nums"
              />
            </div>
            <button
              onClick={() => apply(cFrom, cTo)}
              disabled={!cFrom || !cTo || cFrom > cTo}
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
