import { Tag, Database, User, Package, Star, GitBranch } from "lucide-react";
import type { Lead } from "@/types/lead";

/** Panel danh tính gọn (segments + tag + thuộc tính) — cột trái của Antsomi. */
export function LeadIdentityCard({ lead }: { lead: Lead }) {
  const tags = lead.smaxTags ?? [];

  return (
    <div className="hairline rounded-2xl bg-white p-5">
      <h3 className="mb-3 text-[13px] font-semibold">Hồ sơ & phân nhóm</h3>

      {/* Segments / Tags — thay "Segments" + "Industry vertical" của Antsomi */}
      <div className="mb-4">
        <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-2 font-medium">Nhóm & Tag</div>
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--hot-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--hot)]"
              >
                {t}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-muted-2">Chưa gắn tag/nhóm nào</div>
        )}
      </div>

      {/* Thuộc tính */}
      <div className="divide-y divide-[var(--border-subtle)]">
        <Row icon={Database} label="Nguồn gốc" value={lead.source} />
        <Row icon={Tag} label="Lead source" value={lead.leadSource} />
        <Row icon={GitBranch} label="Stage" value={lead.stage} />
        <Row icon={Package} label="Sản phẩm quan tâm" value={lead.sfProduct} />
        <Row icon={Star} label="SF Rating" value={lead.sfRating} />
        <Row icon={User} label="TVV phụ trách" value={lead.assignee && lead.assignee !== "—" ? lead.assignee : null} />
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Tag;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-2" strokeWidth={1.75} />
      <span className="text-[11.5px] text-muted-2">{label}</span>
      <span className="ml-auto text-right text-[12.5px] font-medium text-foreground">{value}</span>
    </div>
  );
}
