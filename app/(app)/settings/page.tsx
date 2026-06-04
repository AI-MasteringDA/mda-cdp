import { Topbar } from "@/components/Topbar";
import { createClient } from "@/lib/supabase/server";
import {
  User,
  Mail,
  Building2,
  Key,
  Calendar,
  Activity,
  LogOut,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let workspace: { name?: string; id?: string } | null = null;
  let role = "—";
  let lastSync: { source: string; at: string } | null = null;
  let totalLeads = 0;

  if (user) {
    const { data: memberships } = await supabase
      .from("account_member")
      .select("role, account_id, account:account(name)")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (memberships) {
      const acc = (memberships.account as { name?: string } | null) ?? null;
      workspace = { name: acc?.name, id: memberships.account_id };
      role = memberships.role || "—";
    }

    const { data: sync } = await supabase
      .from("sync_job")
      .select("source, started_at")
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sync) lastSync = { source: sync.source, at: sync.started_at };

    const { count } = await supabase
      .from("dim_lead")
      .select("*", { count: "exact", head: true });
    totalLeads = count ?? 0;
  }

  const userName = user?.email?.split("@")[0] || "User";
  const initials = userName.slice(0, 2).toUpperCase();
  const createdAt = user?.created_at ? new Date(user.created_at) : null;

  return (
    <>
      <Topbar title="Tài khoản" />
      <main className="mx-auto max-w-[1280px] px-8 py-8">
        <div className="mb-8">
          <h1 className="text-[28px] font-semibold tracking-tight">Tài khoản & Workspace</h1>
          <p className="mt-1 text-[14px] text-muted">
            Thông tin đăng nhập, role, và stats nhanh.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Profile card */}
          <section className="hairline rounded-2xl bg-white p-6 lg:col-span-2">
            <div className="flex items-start gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-foreground text-white text-[20px] font-bold">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[18px] font-semibold tracking-tight">{userName}</h2>
                <p className="mt-0.5 text-[13px] text-muted">{user?.email}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5 text-[11px] font-medium">
                    <Key className="h-3 w-3" strokeWidth={1.75} />
                    {role.toUpperCase()}
                  </span>
                  {workspace?.name && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-2.5 py-0.5 text-[11px] font-medium">
                      <Building2 className="h-3 w-3" strokeWidth={1.75} />
                      {workspace.name}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 divide-y divide-[var(--border-subtle)]">
              <Row icon={Mail} label="Email" value={user?.email || "—"} />
              <Row icon={User} label="User ID" value={
                <code className="font-mono text-[11px] break-all">{user?.id || "—"}</code>
              } />
              <Row icon={Building2} label="Workspace" value={workspace?.name || "—"} />
              <Row icon={Calendar} label="Đăng ký từ" value={
                createdAt ? createdAt.toLocaleDateString("vi-VN", { year: "numeric", month: "long", day: "numeric" }) : "—"
              } />
              <Row icon={Activity} label="Last login" value={
                user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("vi-VN") : "—"
              } />
            </div>
          </section>

          {/* Quick stats card */}
          <section className="hairline rounded-2xl bg-white p-6">
            <h3 className="text-[14px] font-semibold mb-4">Số liệu nhanh</h3>
            <div className="space-y-4">
              <Stat label="Tổng lead" value={totalLeads.toLocaleString("vi-VN")} />
              <Stat
                label="Sync gần nhất"
                value={
                  lastSync
                    ? `${lastSync.source.toUpperCase()} · ${new Date(lastSync.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`
                    : "Chưa có"
                }
              />
            </div>

            <div className="mt-6 pt-4 border-t border-[var(--border-subtle)]">
              <h4 className="text-[11px] uppercase tracking-wider text-muted-2 font-semibold mb-2">
                Liên kết nhanh
              </h4>
              <div className="space-y-1.5">
                <Link href="/integrations" className="block text-[13px] text-muted hover:text-foreground hover:underline">
                  → Quản lý nguồn data
                </Link>
                <Link href="/scoring" className="block text-[13px] text-muted hover:text-foreground hover:underline">
                  → Cấu hình scoring
                </Link>
                <Link href="/sync-jobs" className="block text-[13px] text-muted hover:text-foreground hover:underline">
                  → Lịch sử sync
                </Link>
              </div>
            </div>

            <form action="/api/auth/sign-out" method="POST" className="mt-6 pt-4 border-t border-[var(--border-subtle)]">
              <button
                type="submit"
                className="press w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--hot)] px-4 py-2.5 text-[13px] font-medium text-white hover:opacity-90"
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
                Đăng xuất
              </button>
            </form>
          </section>
        </div>

        {/* About */}
        <section className="mt-6 hairline rounded-2xl bg-white p-6">
          <h3 className="text-[14px] font-semibold mb-3">Về MDA Platform</h3>
          <p className="text-[13px] text-muted leading-relaxed">
            CDP (Customer Data Platform) cho Mastering Data Analytics. Đồng bộ đa nguồn (Salesforce, SMAX, Instantly, Wix),
            scoring 100-điểm cho hot/warm/cool/dormant lead, AI Planner đề xuất hành động dựa trên data.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-[12px]">
            <a
              href="https://github.com/AI-MasteringDA/mda-cdp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-muted hover:text-foreground hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              Source code
            </a>
            <span className="text-muted-2">·</span>
            <span className="text-muted-2">v0.1.0</span>
          </div>
        </section>
      </main>
    </>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-subtle">
        <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">{label}</div>
        <div className="mt-0.5 text-[13px] text-foreground break-words">{value}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-2 font-medium">{label}</div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
