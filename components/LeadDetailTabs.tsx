"use client";

import { useState } from "react";
import { Timeline } from "./Timeline";
import type { Lead } from "@/types/lead";
import { Mail, MessageCircle, ListChecks, User, Phone, Building2, Calendar, Tag, Globe, Database } from "lucide-react";
import { formatRelativeVi } from "@/lib/utils";

type Tab = "timeline" | "email" | "chat" | "info";

const EMAIL_EVENTS = new Set(["email_sent", "email_open", "email_click", "email_reply"]);
const CHAT_EVENTS = new Set(["chat", "chat_staff", "attachment"]);

export function LeadDetailTabs({ lead }: { lead: Lead }) {
  const [active, setActive] = useState<Tab>("timeline");

  const emailEvents = lead.touchpoints.filter((t) => EMAIL_EVENTS.has(t.type));
  const chatEvents = lead.touchpoints.filter((t) => CHAT_EVENTS.has(t.type));

  return (
    <div>
      {/* Tab buttons */}
      <div className="mb-4 flex items-center gap-1 border-b border-[var(--border-subtle)]">
        <TabButton
          active={active === "timeline"}
          onClick={() => setActive("timeline")}
          icon={ListChecks}
          label="Timeline"
          count={lead.touchpoints.length}
        />
        <TabButton
          active={active === "email"}
          onClick={() => setActive("email")}
          icon={Mail}
          label="Email"
          count={emailEvents.length}
        />
        <TabButton
          active={active === "chat"}
          onClick={() => setActive("chat")}
          icon={MessageCircle}
          label="Chat"
          count={chatEvents.length}
        />
        <TabButton
          active={active === "info"}
          onClick={() => setActive("info")}
          icon={User}
          label="Thông tin"
        />
      </div>

      {/* Tab content */}
      {active === "timeline" && (
        <Timeline touchpoints={lead.touchpoints} />
      )}

      {active === "email" && (
        emailEvents.length > 0 ? (
          <Timeline touchpoints={emailEvents} />
        ) : (
          <EmptyState label="Chưa có email events" />
        )
      )}

      {active === "chat" && (
        chatEvents.length > 0 ? (
          <Timeline touchpoints={chatEvents} />
        ) : (
          <EmptyState label="Chưa có chat events" />
        )
      )}

      {active === "info" && <InfoPanel lead={lead} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`tab-underline press flex items-center gap-2 px-4 py-3 text-[13px] font-medium transition-colors ${
        active ? "active text-foreground" : "text-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={active ? 2 : 1.75} />
      {label}
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
            active ? "bg-foreground text-white" : "bg-subtle text-muted-2"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="hairline rounded-2xl bg-white px-6 py-16 text-center text-[13px] text-muted-2">
      {label}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string | React.ReactNode | null | undefined;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-[var(--border-subtle)] last:border-0">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-subtle">
        <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
          {label}
        </div>
        <div className="mt-0.5 text-[13px] text-foreground break-words">{value}</div>
      </div>
    </div>
  );
}

function InfoPanel({ lead }: { lead: Lead }) {
  // Stats from touchpoints
  const eventStats = new Map<string, number>();
  for (const t of lead.touchpoints) {
    eventStats.set(t.type, (eventStats.get(t.type) || 0) + 1);
  }
  const sourceStats = new Map<string, number>();
  for (const t of lead.touchpoints) {
    sourceStats.set(t.source, (sourceStats.get(t.source) || 0) + 1);
  }

  const firstTouch = lead.touchpoints[lead.touchpoints.length - 1];
  const lastTouch = lead.touchpoints[0];

  return (
    <div className="space-y-6">
      {/* Contact info */}
      <section className="hairline rounded-2xl bg-white p-6">
        <h3 className="text-[14px] font-semibold mb-2">📋 Thông tin liên hệ</h3>
        <div className="divide-y divide-[var(--border-subtle)]">
          <InfoRow icon={User} label="Họ tên" value={lead.name} />
          <InfoRow icon={Mail} label="Email" value={lead.email || "Chưa có"} />
          <InfoRow icon={Phone} label="Số điện thoại" value={lead.phone || "Chưa có"} />
          <InfoRow icon={Building2} label="Công ty" value={lead.company || "Chưa có"} />
          <InfoRow icon={User} label="TVV phụ trách" value={lead.assignee && lead.assignee !== "—" ? lead.assignee : "Chưa gán"} />
        </div>
      </section>

      {/* Source & stage */}
      <section className="hairline rounded-2xl bg-white p-6">
        <h3 className="text-[14px] font-semibold mb-2">🚪 Nguồn & Stage</h3>
        <div className="divide-y divide-[var(--border-subtle)]">
          <InfoRow icon={Database} label="Nguồn gốc" value={lead.source} />
          <InfoRow icon={Tag} label="Lead source chi tiết" value={lead.leadSource || "—"} />
          <InfoRow icon={Tag} label="Stage hiện tại" value={lead.stage} />
          <InfoRow
            icon={Calendar}
            label="Lần đầu xuất hiện"
            value={firstTouch ? `${firstTouch.occurredAt.toLocaleDateString("vi-VN")} (${formatRelativeVi(firstTouch.occurredAt)})` : "—"}
          />
          <InfoRow
            icon={Calendar}
            label="Hoạt động gần nhất"
            value={lastTouch ? `${lastTouch.occurredAt.toLocaleDateString("vi-VN")} (${formatRelativeVi(lastTouch.occurredAt)})` : "—"}
          />
        </div>
      </section>

      {/* Scoring breakdown */}
      <section className="hairline rounded-2xl bg-white p-6">
        <h3 className="text-[14px] font-semibold mb-3">
          🎯 Điểm scoring chi tiết
        </h3>
        <div className="mb-3 flex items-baseline gap-2">
          <div className="gradient-num text-[40px] font-bold tabular-nums tracking-[-0.04em] leading-none">
            {lead.score}
          </div>
          <div className="text-[18px] text-muted-2 font-semibold">/100</div>
          <div className="ml-2 inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
            {lead.tier}
          </div>
        </div>

        {lead.reasons.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
              Cấu thành điểm
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <span className="font-mono w-10 text-right">BASE</span>
                <span>= 40</span>
              </div>
              {lead.reasons.map((r) => (
                <div key={r.label} className="flex items-center gap-2 text-[13px]">
                  <span
                    className={`font-mono tabular-nums w-10 text-right ${
                      r.sign === "+" ? "text-[var(--success)]" : "text-[var(--hot)]"
                    }`}
                  >
                    {r.sign}{r.points}
                  </span>
                  <span>{r.label}</span>
                </div>
              ))}
              <div className="pt-2 mt-2 border-t border-[var(--border-subtle)] flex items-center gap-2 text-[13px] font-semibold">
                <span className="font-mono w-10 text-right">TOTAL</span>
                <span>= {lead.score}/100</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[12px] text-muted-2">Chưa có scoring data</div>
        )}
      </section>

      {/* Activity stats */}
      <section className="hairline rounded-2xl bg-white p-6">
        <h3 className="text-[14px] font-semibold mb-3">📊 Hoạt động</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
              Tổng touchpoints
            </div>
            <div className="mt-1 text-[24px] font-bold tabular-nums">
              {lead.touchpoints.length.toLocaleString("vi-VN")}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">
              Số nguồn
            </div>
            <div className="mt-1 text-[24px] font-bold tabular-nums">
              {sourceStats.size}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium mb-2">
            Theo loại event
          </div>
          <div className="flex flex-wrap gap-2">
            {[...eventStats.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <span
                key={type}
                className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-3 py-1 text-[12px]"
              >
                <span className="font-medium">{type}</span>
                <span className="tabular-nums text-muted">{count}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium mb-2">
            Theo nguồn
          </div>
          <div className="flex flex-wrap gap-2">
            {[...sourceStats.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => (
              <span
                key={source}
                className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-3 py-1 text-[12px]"
              >
                <Globe className="h-3 w-3 text-muted-2" strokeWidth={1.75} />
                <span className="font-medium uppercase tracking-wider text-[10px]">{source}</span>
                <span className="tabular-nums text-muted">{count}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Tech metadata */}
      <section className="hairline rounded-2xl bg-white p-6">
        <h3 className="text-[14px] font-semibold mb-2">🔧 Metadata</h3>
        <div className="divide-y divide-[var(--border-subtle)]">
          <InfoRow icon={Tag} label="Lead ID" value={
            <code className="font-mono text-[11px] break-all">{lead.id}</code>
          } />
          <InfoRow icon={Calendar} label="Created" value={lead.firstSeenAt.toLocaleString("vi-VN")} />
          <InfoRow icon={Calendar} label="Last contact" value={lead.lastContactAt.toLocaleString("vi-VN")} />
        </div>
      </section>
    </div>
  );
}

