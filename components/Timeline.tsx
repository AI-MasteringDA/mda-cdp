import {
  Mail,
  MousePointerClick,
  MessageCircle,
  Eye,
  Phone,
  FileText,
  Send,
  Reply,
  Activity,
} from "lucide-react";
import type { Touchpoint, LeadSource } from "@/types/lead";
import { Chip } from "./ui/Chip";
import { formatRelativeVi } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  email_open: Mail,
  email_click: MousePointerClick,
  email_sent: Send,
  email_reply: Reply,
  chat: MessageCircle,
  page_view: Eye,
  call: Phone,
  form_submit: FileText,
};

const SOURCE_LABEL: Record<LeadSource, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  web: "Website",
  fanpage: "Fanpage",
};

function groupByDate(touchpoints: Touchpoint[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  const groups: { label: string; items: Touchpoint[] }[] = [
    { label: "Hôm nay", items: [] },
    { label: "Hôm qua", items: [] },
    { label: "Tuần này", items: [] },
    { label: "Cũ hơn", items: [] },
  ];

  for (const t of touchpoints) {
    const d = t.occurredAt;
    if (d >= today) groups[0].items.push(t);
    else if (d >= yesterday) groups[1].items.push(t);
    else if (d >= weekAgo) groups[2].items.push(t);
    else groups[3].items.push(t);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function Timeline({ touchpoints }: { touchpoints: Touchpoint[] }) {
  const groups = groupByDate(touchpoints);

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-2 font-medium">
            {group.label}
          </div>
          <div className="space-y-2">
            {group.items.map((t) => {
              const Icon = ICONS[t.type] ?? Activity;
              return (
                <div
                  key={t.id}
                  className="hairline flex gap-4 rounded-xl bg-white p-4 transition-colors hover:border-[var(--border)]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle">
                    <Icon className="h-4 w-4 text-muted" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Chip variant="outline">{SOURCE_LABEL[t.source]}</Chip>
                      <span className="ml-auto text-[11px] text-muted-2">
                        {formatRelativeVi(t.occurredAt)}
                      </span>
                    </div>
                    <div className="mt-1.5 text-[14px] font-medium">{t.title}</div>
                    {t.detail && (
                      <div className="mt-1 text-[12px] text-muted">{t.detail}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
