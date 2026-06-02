import { Topbar } from "@/components/Topbar";
import { StatusDot } from "@/components/ui/StatusDot";
import { getIntegrationsStatus } from "@/lib/supabase/queries";
import { formatRelativeVi } from "@/lib/utils";
import { Plug, ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const integrations = await getIntegrationsStatus();

  return (
    <>
      <Topbar title="Nguồn data" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">
              Kết nối nguồn data
            </h1>
            <p className="mt-1 text-[14px] text-muted">
              Trạng thái đọc realtime từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">sync_job</code> +{" "}
              <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">dim_lead</code>.
            </p>
          </div>
          <button className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-white hover:opacity-90">
            <Plug className="h-4 w-4" strokeWidth={1.75} />
            Thêm nguồn mới
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {integrations.map((integ) => (
            <Link
              key={integ.id}
              href={`/integrations/${integ.id}`}
              className="hairline group block rounded-2xl bg-white p-6 transition-colors hover:border-[var(--border)]"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-semibold tracking-tight">
                      {integ.name}
                    </h3>
                    <span className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
                      {integ.category}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted leading-relaxed">
                    {integ.description}
                  </p>
                </div>
                <ChevronRight
                  className="h-4 w-4 text-muted-2 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={1.75}
                />
              </div>

              <div className="mt-4 flex items-center gap-4 border-t border-[var(--border-subtle)] pt-3">
                <StatusDot status={integ.status} />
                <span className="text-[12px] text-muted-2">·</span>
                <span className="text-[12px] text-muted">{integ.authType}</span>
                {integ.lastSyncAt && (
                  <>
                    <span className="text-[12px] text-muted-2">·</span>
                    <span className="flex items-center gap-1 text-[12px] text-muted">
                      <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
                      Sync {formatRelativeVi(integ.lastSyncAt)}
                    </span>
                  </>
                )}
                {integ.recordCount > 0 && (
                  <span className="ml-auto text-[12px] font-medium tabular-nums">
                    {integ.recordCount.toLocaleString("vi-VN")} lead
                    {integ.touchpointCount > 0 && (
                      <span className="ml-1 text-muted-2">
                        · {integ.touchpointCount.toLocaleString("vi-VN")} tp
                      </span>
                    )}
                  </span>
                )}
              </div>

              {integ.errorMessage && (
                <div className="mt-3 rounded-lg bg-[#fff5f5] p-3 text-[12px] text-[var(--hot)]">
                  {integ.errorMessage}
                </div>
              )}
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
