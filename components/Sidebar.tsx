"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Flame,
  Thermometer,
  Snowflake,
  Moon,
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
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> };

const COCKPIT: NavItem[] = [
  { href: "/dashboard",     label: "Tổng quan",      icon: LayoutDashboard },
  { href: "/hot-leads",     label: "Lead NÓNG",      icon: Flame },
  { href: "/warm-leads",    label: "Lead ẤM",        icon: Thermometer },
  { href: "/cool-leads",    label: "Lead MÁT",       icon: Snowflake },
  { href: "/dormant-leads", label: "Lead NGỦ ĐÔNG",  icon: Moon },
  { href: "/leads",         label: "Tất cả",         icon: Users },
];

const GROWTH: NavItem[] = [
  { href: "/growth",      label: "Tổng quan",       icon: TrendingUp },
  { href: "/attribution", label: "Attribution",     icon: BarChart3 },
  { href: "/funnel",      label: "Phễu & cohort",   icon: GitBranch },
  { href: "/segments",    label: "Phân khúc",       icon: PieChart },
  { href: "/ai-planner",  label: "AI Planner",      icon: Lightbulb },
];

const OPERATIONS: NavItem[] = [
  { href: "/sync-jobs", label: "Hoạt động sync", icon: History },
  { href: "/alerts",    label: "Cảnh báo",       icon: Bell },
  { href: "/audit",     label: "Audit AI",       icon: ListChecks },
];

const CONFIG: NavItem[] = [
  { href: "/integrations",  label: "Nguồn data",     icon: Plug },
  { href: "/identity",      label: "Định danh",      icon: Fingerprint },
  { href: "/scoring",       label: "Điểm số",        icon: Target },
  { href: "/reverse-sync",  label: "Đồng bộ ngược",  icon: ArrowLeftRight },
  { href: "/templates",     label: "Templates AI",   icon: FileText },
  { href: "/team",          label: "Nhân sự",        icon: UserCog },
  { href: "/settings",      label: "Tài khoản",      icon: Settings },
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
    <div className="mb-2">
      <div className="px-3 mt-4 mb-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-2 font-semibold">
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
              "nav-item press group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px]",
              active
                ? "active bg-[var(--subtle)] text-foreground font-semibold"
                : "text-muted hover:bg-[var(--subtle)] hover:text-foreground"
            )}
          >
            <Icon className="h-[15px] w-[15px]" strokeWidth={active ? 2 : 1.75} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar({
  user,
  workspaceName,
}: {
  user?: { email?: string };
  workspaceName?: string;
}) {
  const pathname = usePathname();
  const userName = user?.email?.split("@")[0] || "User";
  const initials = userName.slice(0, 2).toUpperCase();

  async function handleSignOut() {
    const res = await fetch("/api/auth/sign-out", { method: "POST" });
    if (res.ok) window.location.href = "/login";
  }

  return (
    <aside className="hairline-r flex h-screen w-[260px] shrink-0 flex-col bg-[var(--surface)] sticky top-0">
      {/* Brand */}
      <div className="flex h-[68px] items-center gap-3 px-5 hairline-b">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground shadow-sm">
          <Sparkles className="h-4 w-4 text-white" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-bold leading-tight tracking-tight">MDA Platform</div>
          <div className="text-[11px] text-muted-2 leading-tight truncate max-w-[160px]">
            {workspaceName || "Workspace"}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <NavGroup label="Cockpit"   items={COCKPIT}    pathname={pathname} />
        <NavGroup label="Growth"    items={GROWTH}     pathname={pathname} />
        <NavGroup label="Vận hành"  items={OPERATIONS} pathname={pathname} />
        <NavGroup label="Cấu hình"  items={CONFIG}     pathname={pathname} />
      </nav>

      {/* User block */}
      <div className="px-3 py-3 border-t border-[var(--border-subtle)]">
        <div className="bezel">
          <div className="bezel-inner flex items-center gap-3 px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-white text-[11px] font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold">{userName}</div>
              <div className="truncate text-[10px] text-muted-2">{user?.email}</div>
            </div>
            <button
              onClick={handleSignOut}
              title="Đăng xuất"
              className="press rounded-md p-1.5 text-muted-2 hover:bg-[var(--subtle)] hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
