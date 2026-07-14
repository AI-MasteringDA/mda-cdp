/**
 * Dựng lại lỗi 500 ở local: tạo session đăng nhập thật → gắn cookie đúng định
 * dạng @supabase/ssr → gọi trang trên server local (production build).
 * Server local in ra stack trace đầy đủ (production trên Vercel thì che đi).
 *
 * Chạy:  npx next build && npx next start -p 3005      (terminal 1)
 *        npx tsx etl/debug/repro-500-locally.ts        (terminal 2)
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/^﻿/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim().replace(/^﻿/, "");
const svcKey = process.env.SUPABASE_SECRET_KEY!.trim().replace(/^﻿/, "");
const BASE = process.env.LOCAL_URL || "http://localhost:3005";
const PATHS = (process.env.PATHS || "/hot-leads,/dashboard,/leads").split(",");

const admin = createClient(url, svcKey, { auth: { persistSession: false } });
const projectRef = new URL(url).hostname.split(".")[0];
const EMAIL = `cdp-repro-${Date.now()}@mastering-da.com`;
const PASS = `Repro!${Math.random().toString(36).slice(2)}Aa1`;

/** @supabase/ssr lưu session dạng `base64-<b64 json>`, chia mảnh nếu > 3180 ký tự */
function sessionCookies(session: unknown): string {
  const name = `sb-${projectRef}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  const CHUNK = 3180;
  if (value.length <= CHUNK) return `${name}=${value}`;
  const parts: string[] = [];
  for (let i = 0, n = 0; i < value.length; i += CHUNK, n++) {
    parts.push(`${name}.${n}=${value.slice(i, i + CHUNK)}`);
  }
  return parts.join("; ");
}

async function main() {
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASS, email_confirm: true,
  });
  if (cErr) throw new Error(`tạo user: ${cErr.message}`);
  const userId = created.user!.id;

  try {
    const sb = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: signed, error: sErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
    if (sErr) throw new Error(`login: ${sErr.message}`);
    const cookie = sessionCookies(signed.session);
    console.log(`✅ Có session (project ${projectRef})\n`);

    for (const p of PATHS) {
      const t = Date.now();
      const res = await fetch(`${BASE}${p}`, { headers: { cookie }, redirect: "manual" });
      const ms = Date.now() - t;
      const body = await res.text();
      const isErr = res.status >= 500;
      console.log(`${isErr ? "❌" : res.status === 200 ? "✅" : "↪️ "} ${String(res.status).padEnd(4)} ${p.padEnd(14)} ${ms}ms`);
      if (isErr) {
        // trang lỗi của Next in stack ra terminal của server; ở đây bắt phần hiện được
        const m = body.match(/<pre[^>]*>([\s\S]{0,1200})<\/pre>/i);
        if (m) console.log(`   ${m[1].replace(/<[^>]+>/g, "").slice(0, 800)}`);
        else console.log(`   (xem stack trace ở terminal chạy 'next start')`);
      }
      if (res.status >= 300 && res.status < 400) console.log(`   → ${res.headers.get("location")}`);
    }
  } finally {
    await admin.auth.admin.deleteUser(userId);
    console.log("\n(đã xoá user test)");
  }
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
