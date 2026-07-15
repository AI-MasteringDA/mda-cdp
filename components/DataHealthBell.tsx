"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/health-metrics";

/**
 * Chuông "sức khỏe data" trên Topbar. Chấm màu: xanh khỏe / vàng cảnh báo /
 * đỏ nguy. Click → /health. Poll mỗi 2 phút.
 */
export function DataHealthBell() {
  const [overall, setOverall] = useState<Severity | null>(null);
  const [issues, setIssues] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/health").then((x) => x.json());
        if (!alive) return;
        setOverall(r.overall as Severity);
        setIssues((r.sources ?? []).reduce((n: number, s: { issues: string[] }) => n + s.issues.length, 0));
      } catch { /* im lặng */ }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const dot =
    overall === "critical" ? "bg-[var(--hot,#e5484d)]"
    : overall === "warning" ? "bg-[var(--warm,#f5a623)]"
    : overall === "ok" ? "bg-[var(--success,#30a46c)]"
    : "bg-[var(--muted-2,#9ca3af)]";
  const title =
    overall === "critical" ? "Data BẤT THƯỜNG — bấm xem"
    : overall === "warning" ? "Data có cảnh báo — bấm xem"
    : overall === "ok" ? "Data khỏe"
    : "Đang tải trạng thái data";

  return (
    <Link
      href="/health"
      title={title}
      aria-label={title}
      className="press relative grid h-9 w-9 place-items-center rounded-lg border border-[var(--border-subtle)] hover:bg-subtle"
    >
      <HeartPulse className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} />
      <span
        className={cn(
          "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--background)]",
          dot,
          overall === "critical" && "animate-pulse"
        )}
      />
      {issues > 0 && overall !== "ok" && (
        <span className="absolute -right-1.5 -top-2 min-w-[16px] rounded-full bg-[var(--hot,#e5484d)] px-1 text-center text-[10px] font-bold leading-4 text-white">
          {issues}
        </span>
      )}
    </Link>
  );
}
