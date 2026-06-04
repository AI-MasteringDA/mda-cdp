"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusDot } from "@/components/ui/StatusDot";
import { Chip } from "@/components/ui/Chip";
import { ChevronDown, ChevronUp, RefreshCw, Filter, X } from "lucide-react";
import { formatRelativeVi } from "@/lib/utils";
import { useToast } from "@/components/Toast";

type Job = {
  id: string;
  source: string;
  startedAt: Date;
  durationMs?: number;
  status: string;
  recordsIn: number;
  recordsMerged: number;
  errors?: string[];
};

const SOURCE_LABEL: Record<string, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  web: "Wix Website",
  lark: "Lark",
  fanpage: "Facebook",
};

const SOURCES = ["salesforce", "smax", "instantly", "wix"];
const STATUSES = ["success", "failed", "running"];

export function SyncJobsTable({ jobs }: { jobs: Job[] }) {
  const router = useRouter();
  const [filterSource, setFilterSource] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const filtered = jobs.filter((j) => {
    if (filterSource && j.source !== filterSource) return false;
    if (filterStatus && j.status !== filterStatus) return false;
    return true;
  });

  async function triggerSync(source: string) {
    setTriggering(source);
    try {
      const res = await fetch(`/api/cron/sync/${source}`, {
        headers: { "x-manual-trigger": "true" },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`Đã trigger ${source.toUpperCase()} sync`, "Đợi vài giây rồi refresh để xem kết quả");
      } else if (res.status === 401) {
        toast.warning("Không có quyền trigger", "Sync này chỉ chạy được từ cron (cần CRON_SECRET). Trigger qua GitHub Actions thay vì UI.");
      } else {
        toast.error("Sync lỗi", data.error || res.statusText);
      }
    } catch (e) {
      toast.error("Network error", String(e));
    } finally {
      setTriggering(null);
      startTransition(() => router.refresh());
    }
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  const hasFilters = filterSource || filterStatus;

  return (
    <>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-[12px]">
          <Filter className="h-3.5 w-3.5 text-muted-2" strokeWidth={1.75} />
          <span className="text-muted-2">Lọc:</span>
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="press h-8 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] focus:border-foreground outline-none"
          >
            <option value="">Tất cả nguồn</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{SOURCE_LABEL[s] || s}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="press h-8 rounded-md border border-[var(--border-subtle)] bg-white px-2 text-[12px] focus:border-foreground outline-none"
          >
            <option value="">Tất cả status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {hasFilters && (
            <button
              onClick={() => { setFilterSource(""); setFilterStatus(""); }}
              className="press inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground hover:bg-subtle"
            >
              <X className="h-3 w-3" strokeWidth={1.75} />
              Xoá lọc
            </button>
          )}
          <span className="ml-2 text-muted-2">
            {filtered.length} / {jobs.length} jobs
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={pending}
            className="press inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[12px] hover:bg-subtle disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} strokeWidth={1.75} />
            Refresh
          </button>
          <div className="relative group">
            <button className="press inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90">
              Trigger sync →
            </button>
            <div className="absolute right-0 top-full mt-1 z-10 hairline rounded-md bg-white shadow-lg p-1 min-w-[160px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity">
              {SOURCES.map((s) => (
                <button
                  key={s}
                  onClick={() => triggerSync(s)}
                  disabled={triggering === s}
                  className="press block w-full text-left rounded px-3 py-2 text-[12px] hover:bg-subtle disabled:opacity-50"
                >
                  {triggering === s ? "Đang chạy..." : SOURCE_LABEL[s] || s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="hairline overflow-hidden rounded-2xl bg-white">
        <table className="w-full text-[13px]">
          <thead className="hairline-b bg-subtle">
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-2 font-medium">
              <th className="px-6 py-3 w-8"></th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Job ID</th>
              <th className="px-6 py-3">Nguồn</th>
              <th className="px-6 py-3">Bắt đầu</th>
              <th className="px-6 py-3 text-right">Thời gian</th>
              <th className="px-6 py-3 text-right">Records (merged / in)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-muted-2">
                  Không có job nào khớp filter.
                </td>
              </tr>
            ) : (
              filtered.map((job) => {
                const expanded = expandedId === job.id;
                const hasError = !!job.errors?.[0];
                return (
                  <>
                    <tr
                      key={job.id}
                      className={`border-b border-[var(--border-subtle)] hover:bg-subtle ${hasError ? "cursor-pointer" : ""}`}
                      onClick={() => hasError && setExpandedId(expanded ? null : job.id)}
                    >
                      <td className="px-6 py-3">
                        {hasError && (
                          expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-2" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-2" />
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <StatusDot status={job.status as "success" | "failed" | "running"} />
                      </td>
                      <td className="px-6 py-3 font-mono text-[12px]">
                        {job.id.slice(0, 8)}
                      </td>
                      <td className="px-6 py-3">
                        <Chip variant="outline">{SOURCE_LABEL[job.source] ?? job.source}</Chip>
                      </td>
                      <td className="px-6 py-3 text-muted">
                        {formatRelativeVi(job.startedAt)}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums">
                        {job.durationMs ? `${(job.durationMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="px-6 py-3 text-right tabular-nums">
                        {job.recordsMerged} / {job.recordsIn}
                      </td>
                    </tr>
                    {expanded && hasError && (
                      <tr key={`${job.id}-error`} className="border-b border-[var(--border-subtle)] bg-[#fef2f2]">
                        <td colSpan={7} className="px-6 py-3">
                          <div className="text-[11px] uppercase tracking-wider text-[var(--hot)] font-semibold mb-1">
                            Lỗi
                          </div>
                          <pre className="text-[12px] text-muted whitespace-pre-wrap break-all font-mono">
                            {job.errors?.[0]}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
