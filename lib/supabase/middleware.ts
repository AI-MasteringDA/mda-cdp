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
// /api/cohort thêm 2026-09-03 — trang dashboard gọi nó để vẽ phần so sánh khoá,
// nên bot chụp ảnh và người vào bằng mật khẩu chung đều phải qua được cửa này.
const SNAPSHOT_PATHS = ["/radar.html", "/api/radar", "/api/cohort"];
function isSnapshotBypass(request: NextRequest): boolean {
  const secret = process.env.RADAR_SNAPSHOT_KEY;
  if (!secret) return false;
  const pathname = request.nextUrl.pathname;
  if (!SNAPSHOT_PATHS.includes(pathname)) return false;
  return request.nextUrl.searchParams.get("key") === secret;
}

// CỔNG MẬT KHẨU CHUNG cho team xem dashboard (2026-08-17).
// Bối cảnh: Supabase bị khoá vì vượt egress quota làm CHẾT LUÔN Supabase Auth
// (/auth/v1/settings trả 402) ⇒ không ai đăng nhập Google được. Trong khi dữ
// liệu dashboard đọc thẳng Lark Base nên vẫn sống. Cổng này mở đúng 2 đường
// dẫn của dashboard (SNAPSHOT_PATHS), KHÔNG mở phần còn lại của app.
//
// Dùng: vào /radar.html?pw=<RADAR_TEAM_PASSWORD> một lần → cookie giữ 30 ngày,
// lần sau vào /radar.html là được (không cần dán mật khẩu vào URL nữa; cookie
// cũng tự gửi kèm khi trang gọi /api/radar).
//
// TẮT CỔNG NÀY khi Supabase Auth sống lại (bỏ biến RADAR_TEAM_PASSWORD trên
// Vercel là xong — không cần sửa code).
const TEAM_COOKIE = "radar_team";
function teamPasswordCheck(request: NextRequest): "no" | "cookie" | "query" {
  const pw = process.env.RADAR_TEAM_PASSWORD;
  if (!pw) return "no";
  if (!SNAPSHOT_PATHS.includes(request.nextUrl.pathname)) return "no";
  if (request.nextUrl.searchParams.get("pw") === pw) return "query";
  if (request.cookies.get(TEAM_COOKIE)?.value === pw) return "cookie";
  return "no";
}

export async function updateSession(request: NextRequest) {
  if (isSnapshotBypass(request)) return NextResponse.next({ request });

  const team = teamPasswordCheck(request);
  if (team === "cookie") return NextResponse.next({ request });
  if (team === "query") {
    // Đổi ?pw=… lấy cookie rồi chuyển hướng về URL sạch — tránh để mật khẩu
    // nằm lại trong lịch sử duyệt web / link chia sẻ.
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("pw");
    const res = NextResponse.redirect(clean);
    res.cookies.set(TEAM_COOKIE, process.env.RADAR_TEAM_PASSWORD!, {
      httpOnly: true, sameSite: "lax", secure: true, maxAge: 30 * 24 * 3600, path: "/",
    });
    return res;
  }
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

  // Supabase Auth có thể chết cả cụm (2026-08-17: bị khoá egress quota ⇒
  // /auth/v1/settings trả 402). Không bọc try/catch thì middleware ném lỗi và
  // TOÀN BỘ app trả 500 — kể cả trang chỉ cần Lark. Lỗi ⇒ coi như chưa đăng
  // nhập, để luồng bên dưới đá về /login như bình thường.
  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }
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
