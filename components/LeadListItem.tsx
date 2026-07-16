import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Lead } from "@/types/lead";
import { Avatar } from "./ui/Avatar";
import { Chip, ScoreBadge, TierChip } from "./ui/Chip";
import { SignalChips } from "./SignalChips";
import { formatRelativeVi } from "@/lib/utils";

export function LeadListItem({ lead }: { lead: Lead }) {
  // Show top 3 reasons (sorted by impact)
  const topReasons = lead.reasons.slice(0, 3);

  return (
    <Link
      href={`/lead/${lead.id}`}
      className="group row-hover flex items-center gap-4 rounded-xl px-3 py-3"
    >
      <Avatar name={lead.name} color={lead.avatarColor} size={40} src={lead.avatarUrl} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-[14px] font-medium">{lead.name}</div>
          <span className="text-[11px] text-muted-2">·</span>
          <div className="truncate text-[12px] text-muted">{lead.email}</div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {topReasons.map((r) => (
            <Chip
              key={r.label}
              variant={r.sign === "+" ? "positive" : "negative"}
            >
              {r.sign}
              {r.points} {r.label}
            </Chip>
          ))}
          <span
            className="text-[11px] text-muted-2"
            title={`Lần cuối engage: ${lead.lastContactAt.toLocaleString("vi-VN")}\n(chat, mở email, click, reply, call — KHÔNG tính email MDA gửi đi)`}
          >
            · 👤 {formatRelativeVi(lead.lastContactAt)}
          </span>
        </div>
        {/* Tag Sales gắn + hành vi thật ở từng kênh — để biết NÓNG có được xác nhận không */}
        <SignalChips
          className="mt-1.5"
          signals={lead.signals}
          smaxTags={lead.smaxTags}
          sfRating={lead.sfRating}
        />
      </div>

      <TierChip tier={lead.tier} />
      <ScoreBadge score={lead.score} tier={lead.tier} />
      <ChevronRight
        className="hover-arrow h-4 w-4 text-muted-2"
        strokeWidth={1.75}
      />
    </Link>
  );
}
