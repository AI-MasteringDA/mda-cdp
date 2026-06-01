import { LucideIcon } from "lucide-react";
import Link from "next/link";

export function EmptyConfigCard({
  icon: Icon,
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="hairline rounded-2xl bg-white p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
        <Icon className="h-5 w-5 text-muted" strokeWidth={1.5} />
      </div>
      <h3 className="mt-4 text-[16px] font-semibold tracking-tight">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-[13px] text-muted leading-relaxed">
        {description}
      </p>
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-white hover:opacity-90"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
