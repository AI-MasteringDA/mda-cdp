import { Topbar } from "@/components/Topbar";
import { StatusDot } from "@/components/ui/StatusDot";
import { Chip } from "@/components/ui/Chip";
import { getSyncJobs } from "@/lib/supabase/queries";
import { SOURCE_LABEL } from "@/lib/mock-ops";
import { formatRelativeVi } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SyncJobsPage() {
  const jobs = await getSyncJobs(50);
  const successCount = jobs.filter((j) => j.status === "success").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;

  return (
    <>
      <Topbar title="Hoạt động sync" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Hoạt động ETL
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Đọc từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">sync_job</code> ·
            cron 2 AM hằng đêm + retry 3 lần khi lỗi.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="hairline rounded-2xl bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
              Job 24h qua
            </div>
            <div className="mt-2 text-[28px] font-semibold tabular-nums">
              {jobs.length}
            </div>
          </div>
          <div className="hairline rounded-2xl bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
              Thành công
            </div>
            <div className="mt-2 text-[28px] font-semibold tabular-nums text-[var(--success)]">
              {successCount}
            </div>
          </div>
          <div className="hairline rounded-2xl bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
              Thất bại
            </div>
            <div className="mt-2 text-[28px] font-semibold tabular-nums text-[var(--hot)]">
              {failedCount}
            </div>
          </div>
        </div>

        <div className="hairline overflow-hidden rounded-2xl bg-white">
          <table className="w-full text-[13px]">
            <thead className="hairline-b bg-subtle">
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-2 font-medium">
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Job ID</th>
                <th className="px-6 py-3">Nguồn</th>
                <th className="px-6 py-3">Bắt đầu</th>
                <th className="px-6 py-3 text-right">Thời gian</th>
                <th className="px-6 py-3 text-right">Records (merged / in)</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-2">
                    Chưa có job nào. Chạy seed.sql để có data.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-[var(--border-subtle)] hover:bg-subtle"
                  >
                    <td className="px-6 py-3">
                      <StatusDot status={job.status} />
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
