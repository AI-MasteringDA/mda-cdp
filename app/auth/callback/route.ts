import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  // Attach cookies to the redirect response (Next.js 15 quirk: cookies() from
  // next/headers doesn't auto-attach to NextResponse.redirect in route handlers).
  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/^﻿/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim().replace(/^﻿/, ""),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  // CHẶN TÊN MIỀN LẠ: với Google OAuth, bất kỳ ai có tài khoản Google đều bấm
  // đăng nhập được — chỉ cho phép email công ty (thêm miền khác qua
  // ALLOWED_EMAIL_DOMAINS, ngăn cách bằng dấu phẩy).
  const allowed = (process.env.ALLOWED_EMAIL_DOMAINS || "mastering-da.com")
    .split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const email = (data?.user?.email || "").toLowerCase();
  const domain = email.split("@")[1] || "";
  if (allowed.length && !allowed.includes(domain)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(`Email ${email} không thuộc công ty — vui lòng dùng email @${allowed[0]}`)}`
    );
  }

  return response;
}
