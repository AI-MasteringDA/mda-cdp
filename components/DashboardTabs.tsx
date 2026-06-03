"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, TrendingUp, Megaphone, GitBranch, Users } from "lucide-react";

const TABS = [
  { href: "/dashboard",            label: "Tổng quan",      icon: LayoutDashboard },
  { href: "/dashboard/sales",      label: "Sales / TVV",    icon: Users },
  { href: "/dashboard/marketing",  label: "Marketing",      icon: Megaphone },
  { href: "/dashboard/funnel",     label: "Conversion Funnel", icon: GitBranch },
  { href: "/dashboard/trends",     label: "Trends & Cohort", icon: TrendingUp },
];

export function DashboardTabs() {
  const pathname = usePathname();
  return (
    <div className="border-b border-[var(--border-subtle)]">
      <div className="mx-auto max-w-[1280px] px-8">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "tab-underline press flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                  active
                    ? "active text-foreground"
                    : "text-muted hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
