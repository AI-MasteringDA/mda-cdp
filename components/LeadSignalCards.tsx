import { MailOpen, MousePointerClick, Reply, TrendingDown, Award } from "lucide-react";
import type { Lead } from "@/types/lead";
import { churnRisk } from "@/lib/lead-analytics";

function riskColor(risk: number): string {
  if (risk >= 66) return "var(--hot)";
  if (risk >= 33) return "var(--warm)";
  return "var(--success)";
}
function riskLabel(risk: number): string {
  if (risk >= 66) return "Cao — cần chăm ngay";
  if (risk >= 33) return "Trung bình";
  return "Thấp";
}

/**
 * Hàng thẻ chỉ số kiểu Antsomi ("Reactions to Email", "Churn risk", "How this
 * contact compares"). percentile = null → ẩn thẻ so sánh, grid tự co lại.
 */
export function LeadSignalCards({ lead, percentile }: { lead: Lead; percentile: number | null }) {
  const s = lead.signals;
  const hasEmail = s && s.emailOpens + s.emailClicks + s.emailReplies > 0;
  const risk = churnRisk(lead);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Phản hồi Email — số THẬT từ Instantly */}
      <div className="hairline rounded-2xl bg-white p-5">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
          <MailOpen className="h-4 w-4 text-muted" strokeWidth={1.75} />
          Phản hồi Email
        </div>
        {hasEmail ? (
          <div className="grid grid-cols-3 gap-2">
            <Metric icon={MailOpen} label="Đã mở" value={s!.emailOpens} tone="#0284c7" />
            <Metric icon={MousePointerClick} label="Đã click" value={s!.emailClicks} tone="var(--warm)" />
            <Metric icon={Reply} label="Đã trả lời" value={s!.emailReplies} tone="var(--success)" />
          </div>
        ) : (
          <div className="py-4 text-[12.5px] text-muted-2">Chưa có dữ liệu email cho lead này.</div>
        )}
      </div>

      {/* Nguy cơ nguội */}
      <div className="hairline rounded-2xl bg-white p-5">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
          <TrendingDown className="h-4 w-4 text-muted" strokeWidth={1.75} />
          Nguy cơ nguội <span className="text-[11px] font-normal text-muted-2">(ước tính)</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[34px] font-bold leading-none tabular-nums" style={{ color: riskColor(risk) }}>
            {risk}%
          </span>
          <span className="text-[12px] font-medium" style={{ color: riskColor(risk) }}>
            {riskLabel(risk)}
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--subtle)]">
          <div className="h-full rounded-full" style={{ width: `${risk}%`, background: riskColor(risk) }} />
        </div>
      </div>

      {/* So với lead khác — percentile */}
      {percentile !== null && (
        <div className="hairline rounded-2xl bg-white p-5">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
            <Award className="h-4 w-4 text-muted" strokeWidth={1.75} />
            So với lead khác
          </div>
          <div className="flex items-baseline gap-2">
            <span className="gradient-num text-[34px] font-bold leading-none tabular-nums">{percentile}%</span>
          </div>
          <div className="mt-1 text-[12.5px] text-muted">
            Điểm cao hơn <span className="font-semibold text-foreground">{percentile}%</span> tổng số lead
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--subtle)]">
            <div className="h-full rounded-full bg-foreground" style={{ width: `${percentile}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof MailOpen;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--subtle)]/50 px-2 py-2.5 text-center">
      <Icon className="mx-auto h-3.5 w-3.5" strokeWidth={1.75} style={{ color: tone }} />
      <div className="mt-1 text-[22px] font-bold leading-none tabular-nums">{value.toLocaleString("vi-VN")}</div>
      <div className="mt-1 text-[10.5px] text-muted-2">{label}</div>
    </div>
  );
}
