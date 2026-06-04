"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
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
  PanelLeftClose,
  PanelLeftOpen,
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

const MIN_WIDTH = 64;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 260;
const COLLAPSE_THRESHOLD = 130;

function NavGroup({
  label,
  items,
  pathname,
  collapsed,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
}) {
  return (
    <div className="mb-2">
      {!collapsed && (
        <div className="px-3 mt-4 mb-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-2 font-semibold">
          {label}
        </div>
      )}
      {collapsed && <div className="my-2 mx-3 h-px bg-[var(--border-subtle)]" />}
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            className={cn(
              "nav-item press group relative flex items-center gap-3 rounded-lg text-[13px]",
              collapsed ? "justify-center mx-1 px-0 py-2.5" : "px-3 py-2",
              active
                ? "active bg-[var(--subtle)] text-foreground font-semibold"
                : "text-muted hover:bg-[var(--subtle)] hover:text-foreground"
            )}
          >
            <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={active ? 2 : 1.75} />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {collapsed && (
              <span className="pointer-events-none absolute left-full ml-3 z-50 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                {item.label}
              </span>
            )}
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

  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [hydrated, setHydrated] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("mda:sidebar-width");
    if (saved) {
      const n = Number(saved);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) setWidth(n);
    }
    setHydrated(true);
  }, []);

  // Persist on change (debounced via rAF)
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("mda:sidebar-width", String(width));
  }, [width, hydrated]);

  const collapsed = width < COLLAPSE_THRESHOLD;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!isResizing) return;
    function onMove(e: MouseEvent) {
      const dx = e.clientX - startXRef.current;
      let next = startWidthRef.current + dx;
      // Snap "dead zone" between MIN+10 and COLLAPSE_THRESHOLD → snap to MIN (collapsed)
      // Above threshold → free resize
      if (next < COLLAPSE_THRESHOLD) next = MIN_WIDTH;
      next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next));
      setWidth(next);
    }
    function onUp() {
      setIsResizing(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  // Ctrl+B / Cmd+B keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setWidth((w) => (w < COLLAPSE_THRESHOLD ? DEFAULT_WIDTH : MIN_WIDTH));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleCollapsed() {
    setWidth((w) => (w < COLLAPSE_THRESHOLD ? DEFAULT_WIDTH : MIN_WIDTH));
  }

  function handleDoubleClickHandle() {
    // Double-click handle to reset to default
    setWidth(DEFAULT_WIDTH);
  }

  async function handleSignOut() {
    const res = await fetch("/api/auth/sign-out", { method: "POST" });
    if (res.ok) window.location.href = "/login";
  }

  return (
    <aside
      className={cn(
        "hairline-r relative flex h-screen shrink-0 flex-col bg-[var(--surface)] sticky top-0",
        !isResizing && "transition-[width] duration-300 ease-out"
      )}
      style={{ width: `${width}px` }}
    >
      {/* Brand */}
      <div className={cn("flex h-[68px] items-center gap-3 hairline-b", collapsed ? "justify-center px-2" : "px-5")}>
        <Link href="/dashboard" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground shadow-sm press" title="MDA Platform">
          <Sparkles className="h-4 w-4 text-white" strokeWidth={1.75} />
        </Link>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold leading-tight tracking-tight">MDA Platform</div>
            <div className="text-[11px] text-muted-2 leading-tight truncate max-w-[160px]">
              {workspaceName || "Workspace"}
            </div>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={toggleCollapsed}
            title="Thu nhỏ sidebar (Ctrl+B)"
            className="press rounded-md p-1.5 text-muted-2 hover:bg-[var(--subtle)] hover:text-foreground"
          >
            <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Expand button when collapsed */}
      {collapsed && (
        <button
          onClick={toggleCollapsed}
          title="Mở rộng sidebar (Ctrl+B)"
          className="press mx-2 mt-2 flex items-center justify-center rounded-md p-2 text-muted-2 hover:bg-[var(--subtle)] hover:text-foreground"
        >
          <PanelLeftOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}

      {/* Nav */}
      <nav className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-1" : "px-3")}>
        <NavGroup label="Cockpit"   items={COCKPIT}    pathname={pathname} collapsed={collapsed} />
        <NavGroup label="Growth"    items={GROWTH}     pathname={pathname} collapsed={collapsed} />
        <NavGroup label="Vận hành"  items={OPERATIONS} pathname={pathname} collapsed={collapsed} />
        <NavGroup label="Cấu hình"  items={CONFIG}     pathname={pathname} collapsed={collapsed} />
      </nav>

      {/* User block */}
      <div className={cn("py-3 border-t border-[var(--border-subtle)]", collapsed ? "px-1" : "px-3")}>
        {collapsed ? (
          <div className="relative group">
            <button
              onClick={handleSignOut}
              title="Đăng xuất"
              className="press flex w-full items-center justify-center rounded-lg bg-foreground py-2 text-white"
            >
              <span className="text-[11px] font-semibold">{initials}</span>
            </button>
            <span className="pointer-events-none absolute left-full bottom-1 ml-3 z-50 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
              {user?.email || userName} · Đăng xuất
            </span>
          </div>
        ) : (
          <div className="bezel">
            <div className="bezel-inner flex items-center gap-3 px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-white text-[11px] font-semibold">
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
        )}
      </div>

      {/* Resize handle on right edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        onDoubleClick={handleDoubleClickHandle}
        title="Kéo để resize · Double-click để reset"
        className={cn(
          "absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize transition-colors",
          "hover:bg-foreground/20",
          isResizing && "bg-foreground/40"
        )}
      />
    </aside>
  );
}
