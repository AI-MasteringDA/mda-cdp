"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

export async function signUpWithMagicLink(formData: FormData) {
  const email = formData.get("email") as string;
  const workspaceName = (formData.get("workspace_name") as string) || "";
  if (!email) return { error: "Vui lòng nhập email" };

  const supabase = await createClient();
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      // Workspace name is consumed by the auth.users INSERT trigger (handle_new_user_account)
      data: workspaceName ? { workspace_name: workspaceName } : undefined,
    },
  });

  if (error) return { error: error.message };
  return { success: true, email };
}
