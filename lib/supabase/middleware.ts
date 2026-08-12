import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = [
  "/login",
  "/signup",
  "/auth/callback",
  "/api/debug-env",
  "/api/whoami",
  "/api/webhook/", // all webhook receivers (singular, legacy)
  "/api/webhooks/", // webhook receivers (plural)
  "/api/export/", // CSV export endpoints for Google Sheets IMPORTDATA
  "/api/cron/",     // Vercel Cron endpoints (auth via x-vercel-cron header)
];

// Cửa riêng cho bot chụp ảnh dashboard hằng ngày (etl/screenshot/radar-snapshot.ts).
// Bot không đăng nhập Google được nên KHÔNG thể qua middleware bằng session
// thường — thay vào đó, ?key=<RADAR_SNAPSHOT_KEY> mở đúng 2 đường dẫn cần
// thiết (trang tĩnh + API dữ liệu) mà không mở toàn bộ app ra công khai.
const SNAPSHOT_PATHS = ["/radar.html", "/api/radar"];
function isSnapshotBypass(request: NextRequest): boolean {
  const secret = process.env.RADAR_SNAPSHOT_KEY;
  if (!secret) return false;
  const pathname = request.nextUrl.pathname;
  if (!SNAPSHOT_PATHS.includes(pathname)) return false;
  return request.nextUrl.searchParams.get("key") === secret;
}

export async function updateSession(request: NextRequest) {
  if (isSnapshotBypass(request)) return NextResponse.next({ request });
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/^﻿/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim().replace(/^﻿/, ""),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_ROUTES.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
