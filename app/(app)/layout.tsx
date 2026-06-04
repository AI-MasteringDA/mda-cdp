import { Sidebar } from "@/components/Sidebar";
import { NavProgress } from "@/components/NavProgress";
import { KeyboardNav } from "@/components/KeyboardNav";
import { ToastProvider } from "@/components/Toast";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch first account the user belongs to (multi-tenant: 1 user can be in many)
  let workspaceName = "";
  if (user) {
    const { data: memberships } = await supabase
      .from("account_member")
      .select("account_id, account:account(name)")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    const acc = (memberships?.account as { name?: string } | null) ?? null;
    workspaceName = acc?.name || "Workspace";
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <NavProgress />
        <KeyboardNav />
        <Sidebar user={user ? { email: user.email } : undefined} workspaceName={workspaceName} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </ToastProvider>
  );
}
