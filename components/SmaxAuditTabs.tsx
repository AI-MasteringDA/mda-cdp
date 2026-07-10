"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Snowflake, MessageCircleWarning, BellRing } from "lucide-react";

const TABS = [
  { href: "/smax-audit",           label: "Tổng quan",       icon: LayoutDashboard },
  { href: "/smax-audit/cold",      label: "Cold Lead Audit", icon: Snowflake },
  { href: "/smax-audit/unreplied", label: "Chưa phản hồi",   icon: MessageCircleWarning },
  { href: "/smax-audit/followup",  label: "Follow-up",       icon: BellRing },
];

export function SmaxAuditTabs() {
  const pathname = usePathname();
  return (
    <div className="border-b border-[var(--border-subtle)] bg-[var(--background)]/85 backdrop-blur-2xl">
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
                  "tab-underline press flex items-center gap-2 px-5 py-4 text-[13px] font-semibold whitespace-nowrap transition-colors",
                  active ? "active text-foreground" : "text-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
