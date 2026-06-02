import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({
      authenticated: false,
      error: userError?.message,
      hint: "Cookies không persist. Check browser dev tools → Cookies → tìm sb-livfrsqwiyapohomjufb-auth-token",
    });
  }

  const { data: memberships, error: memError } = await supabase
    .from("account_member")
    .select("account_id, role, joined_at, account:account(id, name, owner_email)")
    .eq("user_id", user.id);

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
    memberships: memberships ?? [],
    memberships_error: memError?.message ?? null,
    hint: memberships?.length === 0
      ? "User logged in but không có membership. Trigger handle_new_user_account không fire → check schema migration đã chạy chưa."
      : `User OK, có ${memberships?.length} workspace.`,
  });
}
