"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Flame,
  Snowflake,
  Users,
  Settings,
  Sparkles,
  Plug,
  Fingerprint,
  Target,
  ArrowLeftRight,
  Bell,
  ListChecks,
  History,
  FileText,
  UserCog,
  TrendingUp,
  GitBranch,
  PieChart,
  Lightbulb,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui/Avatar";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> };

const COCKPIT: NavItem[] = [
  { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/hot-leads", label: "Lead nóng", icon: Flame },
  { href: "/cold-leads", label: "Lead nguội", icon: Snowflake },
  { href: "/leads", label: "Tất cả lead", icon: Users },
];

const GROWTH: NavItem[] = [
  { href: "/growth", label: "Tổng quan growth", icon: TrendingUp },
  { href: "/attribution", label: "Attribution", icon: BarChart3 },
  { href: "/funnel", label: "Phễu & cohort", icon: GitBranch },
  { href: "/segments", label: "Phân khúc giá trị", icon: PieChart },
  { href: "/ai-planner", label: "AI Planner", icon: Lightbulb },
];

const OPERATIONS: NavItem[] = [
  { href: "/sync-jobs", label: "Hoạt động sync", icon: History },
  { href: "/alerts", label: "Cảnh báo Lark", icon: Bell },
  { href: "/audit", label: "Audit AI", icon: ListChecks },
];

const CONFIG: NavItem[] = [
  { href: "/integrations", label: "Nguồn data", icon: Plug },
  { href: "/identity", label: "Định danh", icon: Fingerprint },
  { href: "/scoring", label: "Điểm số", icon: Target },
  { href: "/reverse-sync", label: "Đồng bộ ngược", icon: ArrowLeftRight },
  { href: "/templates", label: "Templates AI", icon: FileText },
  { href: "/team", label: "Nhân sự", icon: UserCog },
  { href: "/settings", label: "Tài khoản", icon: Settings },
];

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div className="mb-1">
      <div className="px-3 mt-3 mb-1 text-[10px] uppercase tracking-wider text-muted-2 font-medium">
        {label}
      </div>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
              active
                ? "bg-subtle text-foreground font-medium"
                : "text-muted hover:bg-subtle hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hairline-r flex h-screen w-[240px] shrink-0 flex-col bg-white sticky top-0">
      <div className="flex h-16 items-center gap-2 px-6 hairline-b">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground">
          <Sparkles className="h-4 w-4 text-white" strokeWidth={1.75} />
        </div>
        <div>
          <div className="text-[13px] font-semibold leading-tight">MDA Platform</div>
          <div className="text-[10px] text-muted-2 leading-tight">Cockpit + Growth</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <NavGroup label="Cockpit (Sales)" items={COCKPIT} pathname={pathname} />
        <NavGroup label="Growth (Marketing)" items={GROWTH} pathname={pathname} />
        <NavGroup label="Vận hành" items={OPERATIONS} pathname={pathname} />
        <NavGroup label="Cấu hình" items={CONFIG} pathname={pathname} />
      </nav>

      <div className="px-3 py-3 border-t border-[var(--border-subtle)]">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name="Phương Thảo" color="#FFE3F0" size={32} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">Phương Thảo</div>
            <div className="truncate text-[11px] text-muted-2">Manager</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
