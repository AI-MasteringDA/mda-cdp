import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, RefreshCw, Trash2, AlertCircle } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { StatusDot } from "@/components/ui/StatusDot";
import { Chip } from "@/components/ui/Chip";
import { getIntegrationsStatus, getSyncJobs } from "@/lib/supabase/queries";
import { formatRelativeVi } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function IntegrationDetailPage({
  params,
}: {
  params: Promise<{ source: string }>;
}) {
  const { source } = await params;
  const integrations = await getIntegrationsStatus();
  const integ = integrations.find((i) => i.id === source);
  if (!integ) notFound();

  const allJobs = await getSyncJobs(50);
  const jobs = allJobs.filter((j) => j.source === integ.id).slice(0, 10);

  return (
    <>
      <Topbar title={integ.name} />
      <main className="mx-auto max-w-[1280px] px-8 py-6">
        <nav className="mb-4 flex items-center gap-1.5 text-[12px] text-muted">
          <Link href="/integrations" className="hover:text-foreground">
            Nguồn data
          </Link>
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
          <span className="text-foreground">{integ.name}</span>
        </nav>

        <header className="hairline rounded-2xl bg-white p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-[24px] font-semibold tracking-tight">{integ.name}</h1>
                <Chip variant="outline">{integ.category}</Chip>
              </div>
              <p className="mt-2 text-[14px] text-muted leading-relaxed">{integ.description}</p>
            </div>

            <div className="flex gap-2">
              <button className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] font-medium hover:bg-subtle">
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                Sync ngay
              </button>
              <button className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[13px] font-medium text-[var(--hot)] hover:bg-subtle">
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Ngắt kết nối
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-6 border-t border-[var(--border-subtle)] pt-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">Trạng thái</div>
              <div className="mt-1.5"><StatusDot status={integ.status} /></div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">Loại xác thực</div>
              <div className="mt-1.5 text-[13px] font-medium">{integ.authType}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">Số lead từ nguồn này</div>
              <div className="mt-1.5 text-[13px] font-medium tabular-nums">
                {integ.recordCount.toLocaleString("vi-VN")}
              </div>
            </div>
          </div>
        </header>

        {integ.status === "disconnected" && (
          <section className="mt-6 hairline rounded-2xl bg-[#fff8f0] p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-[var(--warm)]" strokeWidth={1.75} />
              <div>
                <h3 className="text-[14px] font-semibold tracking-tight">
                  Chưa kết nối nguồn này
                </h3>
                <p className="mt-1 text-[12px] text-muted leading-relaxed">
                  Cần API key / OAuth credentials để app pull data tự động. Liên hệ admin
                  để cấp quyền, sau đó bổt biến môi trường trong <code className="font-mono">.env.local</code>.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="mt-6 hairline rounded-2xl bg-white">
          <div className="hairline-b px-6 py-4">
            <h2 className="text-[15px] font-semibold tracking-tight">Lịch sử sync gần đây</h2>
            <p className="mt-0.5 text-[12px] text-muted">10 lần chạy ETL gần nhất từ nguồn này</p>
          </div>
          <div>
            {jobs.length === 0 ? (
              <div className="px-6 py-8 text-center text-[13px] text-muted-2">
                Chưa có job nào chạy.
              </div>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center gap-4 border-b border-[var(--border-subtle)] px-6 py-3 last:border-0"
                >
                  <StatusDot status={job.status} label={false} />
                  <div className="flex-1">
                    <div className="text-[13px] font-medium font-mono">{String(job.id).slice(0, 8)}</div>
                    <div className="mt-0.5 text-[11px] text-muted-2">
                      {formatRelativeVi(job.startedAt)} ·{" "}
                      {job.durationMs ? `${(job.durationMs / 1000).toFixed(1)}s` : "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] tabular-nums font-medium">
                      {job.recordsMerged} / {job.recordsIn}
                    </div>
                    <div className="text-[11px] text-muted-2">merged / in</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </>
  );
}
