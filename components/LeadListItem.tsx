import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Lead } from "@/types/lead";
import { Avatar } from "./ui/Avatar";
import { Chip, ScoreBadge } from "./ui/Chip";
import { formatRelativeVi } from "@/lib/utils";

export function LeadListItem({
  lead,
  variant,
}: {
  lead: Lead;
  variant: "hot" | "cold";
}) {
  const reasons = variant === "hot" ? lead.hotReasons : lead.coldReasons;
  const score = variant === "hot" ? lead.hotScore : lead.coldScore;

  return (
    <Link
      href={`/lead/${lead.id}`}
      className="group flex items-center gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-subtle"
    >
      <Avatar name={lead.name} color={lead.avatarColor} size={40} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-[14px] font-medium">{lead.name}</div>
          <span className="text-[11px] text-muted-2">·</span>
          <div className="truncate text-[12px] text-muted">{lead.email}</div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {reasons.slice(0, 3).map((r) => (
            <Chip key={r} variant="outline">
              {r}
            </Chip>
          ))}
          <span className="text-[11px] text-muted-2">
            · {formatRelativeVi(lead.lastContactAt)}
          </span>
        </div>
      </div>

      <ScoreBadge score={score} variant={variant} />
      <ChevronRight
        className="h-4 w-4 text-muted-2 transition-transform group-hover:translate-x-0.5"
        strokeWidth={1.75}
      />
    </Link>
  );
}
