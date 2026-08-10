"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function signInWithMagicLink(formData: FormData) {
  const email = formData.get("email") as string;
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
    },
  });

  if (error) return { error: error.message };
  return { success: true, email };
}

/**
 * Đăng nhập bằng Google — KHÔNG cần gửi email nên đồng nghiệp tự vào được.
 * (Magic link dùng SMTP mặc định của Supabase, chỉ gửi được cho chủ dự án +
 * giới hạn ~4 mail/giờ → cả team không đăng nhập nổi.)
 * Yêu cầu: bật provider Google trong Supabase → Authentication → Providers.
 */
export async function signInWithGoogle(): Promise<void> {
  const supabase = await createClient();
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: { hd: "mastering-da.com", prompt: "select_account" }, // gợi ý chọn tài khoản công ty
    },
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  if (data?.url) redirect(data.url);
  redirect("/login?error=" + encodeURIComponent("Không tạo được link đăng nhập Google"));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
