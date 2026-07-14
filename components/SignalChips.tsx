import { Mail, MousePointerClick, Reply, Globe, FileText, MessageSquare, Trophy, Tag } from "lucide-react";
import type { LeadSignals } from "@/types/lead";
import { cn } from "@/lib/utils";

/**
 * Tín hiệu hành vi thật của lead ở từng kênh.
 *
 * Ý nghĩa với Sales: tag "Hot Lead" nói lead NÓNG, nhưng dãy chip này cho biết
 * hành vi có XÁC NHẬN điều đó không — lead mở email, click, vào web, submit form
 * hay chỉ được gắn tag mà im hoàn toàn.
 */

type Item = {
  key: keyof LeadSignals;
  icon: typeof Mail;
  label: string;
  /** true = lead CHỦ ĐỘNG (intent thật), false = tín hiệu yếu */
  strong: boolean;
};

const ITEMS: Item[] = [
  { key: "formSubmits", icon: FileText, label: "form", strong: true },
  { key: "emailReplies", icon: Reply, label: "reply", strong: true },
  { key: "emailClicks", icon: MousePointerClick, label: "click", strong: true },
  { key: "chats", icon: MessageSquare, label: "chat", strong: true },
  { key: "conversions", icon: Trophy, label: "đã mua", strong: true },
  { key: "emailOpens", icon: Mail, label: "mở mail", strong: false },
  { key: "webViews", icon: Globe, label: "web", strong: false },
];

export function SignalChips({
  signals,
  smaxTags,
  sfRating,
  className,
}: {
  signals?: LeadSignals;
  smaxTags?: string[];
  sfRating?: string | null;
  className?: string;
}) {
  if (!signals) return null;

  // Tag NÓNG do Sales gắn (SMAX của Giàu hoặc SF Rating)
  const norm = (t: string) => t.toLowerCase().replace(/[\s_-]/g, "");
  const smaxHot = (smaxTags ?? []).some((t) => norm(t) === "hotlead");
  const salesHot = smaxHot || sfRating === "Hot";
  const active = ITEMS.filter((i) => Number(signals[i.key]) > 0);

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {salesHot && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--hot)_12%,transparent)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--hot)]"
          title={smaxHot ? "Giàu gắn tag Hot Lead trên SMAX" : "Sales gắn Rating=Hot trên Salesforce"}
        >
          <Tag className="h-3 w-3" strokeWidth={2.25} />
          Sales: NÓNG
        </span>
      )}

      {active.map(({ key, icon: Icon, label, strong }) => (
        <span
          key={key}
          title={`${signals[key]} ${label}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums",
            strong
              ? "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]"
              : "bg-subtle text-muted"
          )}
        >
          <Icon className="h-3 w-3" strokeWidth={2} />
          {label} {Number(signals[key]) > 1 ? `×${signals[key]}` : ""}
        </span>
      ))}

      {salesHot && !signals.hasRealEngagement && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--warm)_14%,transparent)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--warm)]"
          title="Sales tag NÓNG nhưng CDP chưa ghi nhận hành vi nào — có thể lead chat Zalo/gọi điện (kênh không track), hoặc tag đã cũ"
        >
          ⚠ chưa có hành vi
        </span>
      )}
    </div>
  );
}
