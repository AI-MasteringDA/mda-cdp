"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, TrendingUp, Megaphone, GitBranch, Users } from "lucide-react";

const TABS = [
  { href: "/dashboard",            label: "Tổng quan",        icon: LayoutDashboard },
  { href: "/dashboard/sales",      label: "Sales / TVV",      icon: Users },
  { href: "/dashboard/marketing",  label: "Marketing",        icon: Megaphone },
  { href: "/dashboard/funnel",     label: "Conversion Funnel",icon: GitBranch },
  { href: "/dashboard/trends",     label: "Trends",           icon: TrendingUp },
];

export function DashboardTabs() {
  const pathname = usePathname();
  return (
    <div className="border-b border-[var(--border-subtle)] bg-[var(--background)]/85 backdrop-blur-2xl">
      <div className="mx-auto max-w-[1400px] px-8">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "tab-underline press flex items-center gap-2 px-5 py-4 text-[13px] font-semibold whitespace-nowrap transition-colors",
                  active
                    ? "active text-foreground"
                    : "text-muted hover:text-foreground"
                )}
              >
                <Icon className="h-[15px] w-[15px]" strokeWidth={active ? 2 : 1.75} />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
