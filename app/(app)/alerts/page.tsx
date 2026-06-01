import { Topbar } from "@/components/Topbar";
import { StatusDot } from "@/components/ui/StatusDot";
import { Chip } from "@/components/ui/Chip";
import { getAlertEvents } from "@/lib/supabase/queries";
import { formatRelativeVi } from "@/lib/utils";
import { Bell, Plus } from "lucide-react";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const events = await getAlertEvents(20);

  return (
    <>
      <Topbar title="Cảnh báo Lark" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Cảnh báo Lark</h1>
            <p className="mt-1 text-[14px] text-muted">
              Cron riêng quét lead nóng quá hạn → gửi tin Lark cho TVV. Đọc từ{" "}
              <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">lark_alert</code>.
            </p>
          </div>
          <button className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-white hover:opacity-90">
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            Thêm rule
          </button>
        </div>

        {events.length === 0 ? (
          <EmptyConfigCard
            icon={Bell}
            title="Chưa có cảnh báo nào"
            description="Cần cấu hình Lark webhook URL + rule alert. Cron job sẽ chạy mỗi giờ, quét lead nóng-quá-hạn, gửi tin qua Lark bot."
            ctaLabel="Đi đến Nguồn data → Lark"
            ctaHref="/integrations/lark"
          />
        ) : (
          <section className="hairline rounded-2xl bg-white">
            <div className="hairline-b px-6 py-4">
              <h2 className="text-[15px] font-semibold tracking-tight">Lịch sử cảnh báo</h2>
            </div>
            <div>
              {events.map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start gap-4 border-b border-[var(--border-subtle)] px-6 py-3 last:border-0"
                >
                  <StatusDot status={evt.delivered ? "success" : "failed"} label={false} />
                  <div className="flex-1">
                    <div className="text-[13px]">
                      <span className="font-medium">{evt.leadName}</span>
                      <span className="text-muted"> · {evt.reason}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-2">
                      {evt.ruleName} · {formatRelativeVi(evt.sentAt)}
                    </div>
                  </div>
                  <Chip variant={evt.delivered ? "success" : "hot"}>
                    {evt.delivered ? "Đã gửi" : "Lỗi"}
                  </Chip>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
