/** Gọi thẳng production bằng session đăng nhập thật — xác nhận trang render OK. */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/^﻿/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim().replace(/^﻿/, "");
const svcKey = process.env.SUPABASE_SECRET_KEY!.trim().replace(/^﻿/, "");
const BASE = process.env.BASE || "https://mda-cdp.vercel.app";
const PATHS = (process.env.PATHS || "/hot-leads,/hot-leads?eng=engaged,/hot-leads?eng=silent,/warm-leads,/leads,/dashboard,/smax-audit").split(",");

const admin = createClient(url, svcKey, { auth: { persistSession: false } });
const ref = new URL(url).hostname.split(".")[0];
const EMAIL = `cdp-probe-${Date.now()}@mastering-da.com`;
const PASS = `Probe!${Math.random().toString(36).slice(2)}Aa1`;

function cookieFor(session: unknown): string {
  const name = `sb-${ref}-auth-token`;
  const v = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  const C = 3180;
  if (v.length <= C) return `${name}=${v}`;
  const parts: string[] = [];
  for (let i = 0, n = 0; i < v.length; i += C, n++) parts.push(`${name}.${n}=${v.slice(i, i + C)}`);
  return parts.join("; ");
}

async function main() {
  const { data: c, error: ce } = await admin.auth.admin.createUser({ email: EMAIL, password: PASS, email_confirm: true });
  if (ce) throw new Error(ce.message);
  try {
    const sb = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: s, error: se } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
    if (se) throw new Error(se.message);
    const cookie = cookieFor(s.session);
    console.log(`Probe ${BASE}\n`);
    let bad = 0;
    for (const p of PATHS) {
      const t = Date.now();
      const res = await fetch(`${BASE}${p}`, { headers: { cookie }, redirect: "manual" });
      const body = await res.text();
      // Next trả 200 nhưng nhét lỗi vào RSC stream → phải soi nội dung
      const rscErr = /An error occurred in the Server Components render|couldn.t load/i.test(body);
      const ok = res.status === 200 && !rscErr;
      if (!ok) bad++;
      const leadRows = (body.match(/\/lead\//g) || []).length;
      console.log(`${ok ? "✅" : "❌"} ${String(res.status).padEnd(4)} ${p.padEnd(26)} ${String(Date.now() - t).padStart(5)}ms  ${ok ? `${leadRows} lead trên trang` : "LỖI RENDER"}`);
    }
    console.log(`\n${bad === 0 ? "✅ TẤT CẢ TRANG CHẠY ĐƯỢC" : `❌ còn ${bad} trang lỗi`}`);
  } finally {
    await admin.auth.admin.deleteUser(c.user!.id);
  }
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
