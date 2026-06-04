import { Topbar } from "@/components/Topbar";
import { SyncJobsTable } from "@/components/SyncJobsTable";
import { getSyncJobs } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function SyncJobsPage() {
  const jobs = await getSyncJobs(100);
  const successCount = jobs.filter((j) => j.status === "success").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;
  const runningCount = jobs.filter((j) => j.status === "running").length;

  return (
    <>
      <Topbar title="Hoạt động sync" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">
            Hoạt động ETL
          </h1>
          <p className="mt-1 text-[14px] text-muted">
            Đọc realtime từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">sync_job</code>.
            Cron chạy hàng giờ qua GitHub Actions · click vào job lỗi để xem chi tiết.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="hairline rounded-2xl bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
              Tổng job
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
          <div className="hairline rounded-2xl bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
              Đang chạy
            </div>
            <div className="mt-2 text-[28px] font-semibold tabular-nums text-[var(--accent)]">
              {runningCount}
            </div>
          </div>
        </div>

        <SyncJobsTable jobs={jobs} />
      </main>
    </>
  );
}
