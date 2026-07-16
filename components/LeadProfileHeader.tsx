import { Avatar } from "./ui/Avatar";
import { Chip } from "./ui/Chip";
import { LeadActionBar } from "./LeadActionBar";
import { Star, Mail, MessageCircle, Globe, Phone, Building2 } from "lucide-react";
import type { Lead } from "@/types/lead";
import { formatRelativeVi } from "@/lib/utils";
import { scoreToStars, closeProbability, lifecycleLabel, activeChannels, type Channel, type Tone } from "@/lib/lead-analytics";

const TONE: Record<Tone, { bg: string; fg: string }> = {
  hot: { bg: "var(--hot-soft)", fg: "var(--hot)" },
  warm: { bg: "var(--warm-soft)", fg: "var(--warm)" },
  cool: { bg: "#e0f2fe", fg: "#0284c7" },
  dormant: { bg: "#f4f4f5", fg: "#71717a" },
};

const RING: Record<Lead["tier"], string> = {
  "NÓNG": "#dc2626",
  "ẤM": "#ea580c",
  "MÁT": "#0284c7",
  "NGỦ ĐÔNG": "#a1a1aa",
};

const CH_ICON: Record<Channel, typeof Mail> = {
  email: Mail,
  chat: MessageCircle,
  web: Globe,
  phone: Phone,
};
const CH_LABEL: Record<Channel, string> = {
  email: "Email",
  chat: "Chat/Zalo",
  web: "Website",
  phone: "Điện thoại",
};

function Stars({ score }: { score: number }) {
  const stars = scoreToStars(score);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${stars}/5 sao (${score}/100 điểm)`}>
      <span className="relative inline-flex">
        <span className="flex gap-0.5 text-[#e4e4e7]">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />
          ))}
        </span>
        <span
          className="absolute inset-y-0 left-0 flex gap-0.5 overflow-hidden text-[#f5a623]"
          style={{ width: `${(score / 100) * 100}%` }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="h-3.5 w-3.5 shrink-0" fill="currentColor" strokeWidth={0} />
          ))}
        </span>
      </span>
      <span className="text-[12px] font-medium text-muted-2">{stars.toFixed(1)}</span>
    </span>
  );
}

export function LeadProfileHeader({ lead }: { lead: Lead }) {
  const life = lifecycleLabel(lead);
  const tone = TONE[life.tone];
  const prob = closeProbability(lead);
  const channels = activeChannels(lead);
  const netPoints = lead.reasons.reduce((s, r) => s + (r.sign === "+" ? r.points : -r.points), 0);

  return (
    <header className="hairline overflow-hidden rounded-2xl bg-white">
      <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-start">
        {/* Avatar + danh tính */}
        <div className="flex min-w-0 flex-1 items-start gap-5">
          <div
            className="shrink-0 rounded-full p-[3px]"
            style={{ background: `linear-gradient(135deg, ${RING[lead.tier]}, ${RING[lead.tier]}55)` }}
          >
            <div className="rounded-full bg-white p-[2px]">
              <Avatar name={lead.name} color={lead.avatarColor} size={72} src={lead.avatarUrl} />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[24px] font-semibold tracking-tight">{lead.name}</h1>
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{ background: tone.bg, color: tone.fg }}
              >
                {life.label}
              </span>
              <Chip variant="outline">{lead.stage}</Chip>
            </div>

            <div className="mt-1.5">
              <Stars score={lead.score} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              {lead.email && <span>{lead.email}</span>}
              {lead.email && lead.phone && <span className="text-muted-2">·</span>}
              {lead.phone && <span>{lead.phone}</span>}
              {lead.company && (
                <span className="inline-flex items-center gap-1 text-muted">
                  <Building2 className="h-3.5 w-3.5 text-muted-2" strokeWidth={1.75} />
                  {lead.company}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-2">
              <span>
                Khách từ <span className="font-medium text-foreground">{lead.firstSeenAt.toLocaleDateString("vi-VN")}</span>
              </span>
              <span>
                Tương tác cuối <span className="font-medium text-foreground">{formatRelativeVi(lead.lastContactAt)}</span>
              </span>
              <span>
                Nguồn <span className="font-medium text-foreground">{lead.source}</span>
              </span>
              {lead.assignee && lead.assignee !== "—" && (
                <span>
                  TVV <span className="font-medium text-foreground">{lead.assignee}</span>
                </span>
              )}
            </div>

            {/* Kênh hiện diện */}
            {channels.length > 0 && (
              <div className="mt-3 flex items-center gap-1.5">
                {channels.map((c) => {
                  const Icon = CH_ICON[c];
                  return (
                    <span
                      key={c}
                      title={CH_LABEL[c]}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-subtle text-muted"
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 2 chỉ số lớn — thay "Spent so far / Predicted to spend" của Antsomi */}
        <div className="flex shrink-0 items-stretch gap-3">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--subtle)]/40 px-5 py-4 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">Điểm hiện tại</div>
            <div className="mt-1 flex items-baseline justify-center gap-1">
              <span className="gradient-num text-[34px] font-bold leading-none tabular-nums tracking-[-0.03em]">{lead.score}</span>
              <span className="text-[14px] font-semibold text-muted-2">/100</span>
            </div>
            <div className="mt-1 text-[11px]" style={{ color: RING[lead.tier] }}>
              {netPoints >= 0 ? "+" : ""}{netPoints} so với base
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--subtle)]/40 px-5 py-4 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-2 font-medium">Xác suất chốt</div>
            <div className="mt-1 flex items-baseline justify-center gap-1">
              <span className="text-[34px] font-bold leading-none tabular-nums tracking-[-0.03em]">{prob}</span>
              <span className="text-[14px] font-semibold text-muted-2">%</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-2">ước tính</div>
          </div>
        </div>
      </div>

      {/* Cấu thành điểm */}
      {lead.reasons.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] px-6 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] uppercase tracking-wider text-muted-2 font-medium">Cấu thành điểm</span>
            {lead.reasons.map((r) => (
              <Chip key={r.label} variant={r.sign === "+" ? "positive" : "negative"}>
                {r.sign}
                {r.points} {r.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-[var(--border-subtle)] px-6 py-3">
        <LeadActionBar lead={lead} />
      </div>
    </header>
  );
}
