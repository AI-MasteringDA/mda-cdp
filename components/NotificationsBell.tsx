"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, Inbox } from "lucide-react";
import { formatRelativeVi } from "@/lib/utils";

type Alert = {
  id: string;
  ruleName: string;
  reason: string;
  sentAt: string;
  delivered: boolean;
  leadId: string;
  leadName: string;
};

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch alerts on mount + every 60s
  useEffect(() => {
    async function fetchAlerts() {
      setLoading(true);
      try {
        const res = await fetch("/api/alerts/recent");
        if (!res.ok) return;
        const data = await res.json();
        setAlerts(data.alerts || []);
        setUnread(data.unread || 0);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    fetchAlerts();
    const timer = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(timer);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const Icon = unread > 0 ? BellRing : Bell;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="press relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-muted transition-all hover:bg-[var(--subtle)] hover:text-foreground"
        title={`${unread} thông báo mới`}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--hot)] px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] hairline rounded-2xl bg-white shadow-xl overflow-hidden">
          <div className="hairline-b px-4 py-3 flex items-center justify-between">
            <div>
              <h3 className="text-[14px] font-semibold">Thông báo</h3>
              <p className="text-[11px] text-muted-2 mt-0.5">
                {unread > 0 ? `${unread} mới trong 24h` : "Không có thông báo mới"}
              </p>
            </div>
            <Link
              href="/alerts"
              onClick={() => setOpen(false)}
              className="text-[11px] font-medium text-[var(--accent)] hover:underline"
            >
              Xem tất cả →
            </Link>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading && alerts.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-2">Đang tải...</div>
            ) : alerts.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <Inbox className="mx-auto h-8 w-8 text-muted-2 mb-2" strokeWidth={1.5} />
                <p className="text-[13px] text-muted-2">Chưa có thông báo</p>
                <p className="text-[11px] text-muted-2 mt-1">
                  Cảnh báo sẽ xuất hiện khi có lead NÓNG mới hoặc rule bị trigger.
                </p>
              </div>
            ) : (
              alerts.map((a) => (
                <Link
                  key={a.id}
                  href={`/lead/${a.leadId}`}
                  onClick={() => setOpen(false)}
                  className="block hairline-b px-4 py-3 hover:bg-subtle transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.delivered ? "bg-[var(--success)]" : "bg-[var(--warm)]"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-medium truncate">{a.leadName}</span>
                        <span className="text-[10px] text-muted-2 shrink-0">
                          {formatRelativeVi(new Date(a.sentAt))}
                        </span>
                      </div>
                      <p className="text-[12px] text-muted line-clamp-2 mt-0.5">{a.ruleName}</p>
                      {a.reason && (
                        <p className="text-[11px] text-muted-2 line-clamp-1 mt-0.5">{a.reason}</p>
                      )}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
