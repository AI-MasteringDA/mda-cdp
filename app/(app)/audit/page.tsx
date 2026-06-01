import { Topbar } from "@/components/Topbar";
import { Chip } from "@/components/ui/Chip";
import { getAuditLog } from "@/lib/supabase/queries";
import { formatRelativeVi } from "@/lib/utils";
import { Sparkles, ListChecks } from "lucide-react";
import { EmptyConfigCard } from "@/components/EmptyConfigCard";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "outline" | "warm" | "success" | "hot"> = {
  draft: "outline",
  approved: "warm",
  sent: "success",
  rejected: "hot",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  approved: "Đã duyệt",
  sent: "Đã gửi",
  rejected: "Từ chối",
};

export default async function AuditPage() {
  const logs = await getAuditLog(50);
  const stats = {
    total: logs.length,
    sent: logs.filter((l) => l.status === "sent").length,
    rejected: logs.filter((l) => l.status === "rejected").length,
    pending: logs.filter((l) => l.status === "draft").length,
  };

  return (
    <>
      <Topbar title="Audit AI" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-6">
          <h1 className="text-[28px] font-semibold tracking-tight">Nhật ký AI</h1>
          <p className="mt-1 text-[14px] text-muted">
            Đọc từ <code className="font-mono text-[12px] bg-subtle px-1.5 py-0.5 rounded">ai_audit</code>.
            Mọi gợi ý Claude + ai duyệt + nội dung sẽ log ở đây.
          </p>
        </div>

        {logs.length === 0 ? (
          <EmptyConfigCard
            icon={Sparkles}
            title="Chưa có bản nháp AI nào"
            description="Bảng audit sẽ điền tự động khi user bấm 'Tạo bản nháp' trong hồ sơ lead. Cần cấu hình Claude API trước."
            ctaLabel="Đến Templates AI"
            ctaHref="/templates"
          />
        ) : (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
              <StatCard label="Tổng nháp" value={stats.total} />
              <StatCard label="Đã gửi" value={stats.sent} color="success" />
              <StatCard label="Từ chối" value={stats.rejected} color="hot" />
              <StatCard label="Chờ duyệt" value={stats.pending} color="warm" />
            </div>

            <div className="hairline overflow-hidden rounded-2xl bg-white">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex gap-4 border-b border-[var(--border-subtle)] px-6 py-4 last:border-0"
                >
                  <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.75} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{log.templateName}</span>
                      <Chip variant={STATUS_VARIANT[log.status] ?? "outline"}>
                        {STATUS_LABEL[log.status] ?? log.status}
                      </Chip>
                    </div>
                    <div className="mt-1 text-[12px] text-muted-2">
                      Cho <span className="text-foreground font-medium">{log.leadName}</span>
                      {" · sinh "}{formatRelativeVi(log.generatedAt)}
                    </div>
                    {log.preview && (
                      <p className="mt-2 text-[12px] text-muted italic line-clamp-2">
                        &ldquo;{log.preview}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: "success" | "hot" | "warm" }) {
  const cls = color === "success" ? "text-[var(--success)]" : color === "hot" ? "text-[var(--hot)]" : color === "warm" ? "text-[var(--warm)]" : "";
  return (
    <div className="hairline rounded-2xl bg-white p-5">
      <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">{label}</div>
      <div className={`mt-2 text-[28px] font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
