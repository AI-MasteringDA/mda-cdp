"use client";

import { useState } from "react";
import {
  Mail,
  MousePointerClick,
  MessageCircle,
  MessageSquareReply,
  Eye,
  Phone,
  FileText,
  Send,
  Reply,
  UserPlus,
  Trophy,
  XCircle,
  Calendar,
  Paperclip,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { Touchpoint, LeadSource } from "@/types/lead";
import { Chip } from "./ui/Chip";
import { formatRelativeVi } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  lead_created: UserPlus,
  email_open: Mail,
  email_click: MousePointerClick,
  email_sent: Send,
  email_reply: Reply,
  chat: MessageCircle,
  chat_staff: MessageSquareReply,
  page_view: Eye,
  call: Phone,
  meeting: Calendar,
  note: FileText,
  form_submit: FileText,
  conversion: Trophy,
  lost: XCircle,
  attachment: Paperclip,
};

const SOURCE_LABEL: Record<LeadSource, string> = {
  salesforce: "Salesforce",
  smax: "SMAX",
  instantly: "Instantly",
  web: "Website",
  fanpage: "Fanpage",
};

const EMAIL_EVENT_TYPES = new Set(["email_sent", "email_open", "email_click", "email_reply"]);

type TimelineItem =
  | { kind: "single"; tp: Touchpoint }
  | { kind: "email_group"; items: Touchpoint[] };

/**
 * Group CONSECUTIVE email events (same source) into a single collapsible row.
 * Reasoning: a single nurture campaign sending many emails to same lead clutters
 * the timeline. Important events (chat, conversion, call) stay un-grouped.
 *
 * Rule: 3+ consecutive email events from instantly/salesforce → collapse.
 */
function smartGroup(touchpoints: Touchpoint[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let buffer: Touchpoint[] = [];

  function flush() {
    if (buffer.length === 0) return;
    if (buffer.length >= 3) {
      result.push({ kind: "email_group", items: buffer });
    } else {
      for (const tp of buffer) result.push({ kind: "single", tp });
    }
    buffer = [];
  }

  for (const tp of touchpoints) {
    const isEmail = EMAIL_EVENT_TYPES.has(tp.type) && (tp.source === "instantly" || tp.source === "salesforce");
    if (isEmail) {
      buffer.push(tp);
    } else {
      flush();
      result.push({ kind: "single", tp });
    }
  }
  flush();
  return result;
}

function groupByDate(items: TimelineItem[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups: { label: string; items: TimelineItem[] }[] = [
    { label: "Hôm nay", items: [] },
    { label: "Hôm qua", items: [] },
    { label: "Tuần này", items: [] },
    { label: "Cũ hơn", items: [] },
  ];

  function dateOf(it: TimelineItem): Date {
    return it.kind === "single" ? it.tp.occurredAt : it.items[0].occurredAt;
  }

  for (const it of items) {
    const d = dateOf(it);
    if (d >= today) groups[0].items.push(it);
    else if (d >= yesterday) groups[1].items.push(it);
    else if (d >= weekAgo) groups[2].items.push(it);
    else groups[3].items.push(it);
  }
  return groups.filter((g) => g.items.length > 0);
}

function EmailGroupRow({ items }: { items: Touchpoint[] }) {
  const [expanded, setExpanded] = useState(false);
  const latest = items[0];
  const oldest = items[items.length - 1];
  const source = latest.source;

  return (
    <div className="hairline rounded-xl bg-white transition-colors hover:border-[var(--border)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-4 p-4 text-left"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-subtle">
          <Mail className="h-4 w-4 text-muted" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Chip variant="outline">{SOURCE_LABEL[source]}</Chip>
            <span className="text-[11px] font-medium text-muted-2">
              {items.length} emails
            </span>
            <span className="ml-auto text-[11px] text-muted-2">
              {formatRelativeVi(latest.occurredAt)} → {formatRelativeVi(oldest.occurredAt)}
            </span>
          </div>
          <div className="mt-1.5 text-[14px] font-medium">
            📧 Đã nhận {items.length} email từ MDA
          </div>
          <div className="mt-1 text-[12px] text-muted">
            Mới nhất: <span className="italic">&quot;{(latest.title || "").replace(/^Đã gửi email: /, "").slice(0, 80)}&quot;</span>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-2 shrink-0" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-2 shrink-0" strokeWidth={1.75} />
        )}
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3 space-y-2 bg-subtle/30">
          {items.map((t) => {
            const Icon = ICONS[t.type] ?? Mail;
            return (
              <div key={t.id} className="flex gap-3 text-[12px]">
                <Icon className="h-3.5 w-3.5 text-muted-2 shrink-0 mt-0.5" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="text-foreground line-clamp-1">{t.title}</div>
                  <div className="text-muted-2 text-[11px]">{formatRelativeVi(t.occurredAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SenderBadge({ senderIsStaff }: { senderIsStaff: boolean | null | undefined }) {
  if (senderIsStaff === undefined) return null;
  if (senderIsStaff === null) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f5] px-1.5 py-0.5 text-[10px] font-medium text-muted-2"
        title="Không xác định được người gửi (data cũ)"
      >
        ❓ Không rõ
      </span>
    );
  }
  return senderIsStaff ? (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[#eff6ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#0064d0]"
      title="MDA staff/TVV gửi"
    >
      💼 TVV
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[#f0fdf4] px-1.5 py-0.5 text-[10px] font-semibold text-[#15803d]"
      title="Lead/khách hàng gửi — tín hiệu engagement!"
    >
      👤 LEAD
    </span>
  );
}

function SingleRow({ t }: { t: Touchpoint }) {
  const Icon = ICONS[t.type] ?? MessageCircle;
  // Highlight LEAD-sent attachments — they're high-value engagement signal
  const isLeadAttachment = t.type === "attachment" && t.senderIsStaff === false;
  return (
    <div
      className={`hairline flex gap-4 rounded-xl p-4 transition-colors hover:border-[var(--border)] ${
        isLeadAttachment ? "bg-[#f0fdf4]/40 ring-1 ring-[#bbf7d0]" : "bg-white"
      }`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
        isLeadAttachment ? "bg-[#bbf7d0]" : "bg-subtle"
      }`}>
        <Icon className={`h-4 w-4 ${isLeadAttachment ? "text-[#15803d]" : "text-muted"}`} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Chip variant="outline">{SOURCE_LABEL[t.source]}</Chip>
          <SenderBadge senderIsStaff={t.senderIsStaff} />
          <span className="ml-auto text-[11px] text-muted-2">{formatRelativeVi(t.occurredAt)}</span>
        </div>
        <div className="mt-1.5 text-[14px] font-medium">{t.title}</div>
        {t.detail && <div className="mt-1 text-[12px] text-muted">{t.detail}</div>}
      </div>
    </div>
  );
}

export function Timeline({ touchpoints }: { touchpoints: Touchpoint[] }) {
  const grouped = smartGroup(touchpoints);
  const byDate = groupByDate(grouped);

  return (
    <div className="space-y-8">
      {byDate.map((group) => (
        <div key={group.label}>
          <div className="mb-3 text-[11px] uppercase tracking-wider text-muted-2 font-medium">
            {group.label}
          </div>
          <div className="space-y-2">
            {group.items.map((it, idx) =>
              it.kind === "email_group" ? (
                <EmailGroupRow key={`grp-${idx}`} items={it.items} />
              ) : (
                <SingleRow key={it.tp.id} t={it.tp} />
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
