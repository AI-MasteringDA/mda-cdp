/**
 * Đo trang /hot-leads đúng như app chạy: role `authenticated` (user đã login),
 * KHÔNG phải `anon` (test trước) và cũng không phải service_role (bỏ qua RLS).
 *
 * Tạo user test tạm → login → chạy query → xoá user.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/^﻿/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim().replace(/^﻿/, "");
const svcKey = process.env.SUPABASE_SECRET_KEY!.trim().replace(/^﻿/, "");

const admin = createClient(url, svcKey, { auth: { persistSession: false } });
const EMAIL = `cdp-perf-probe-${Date.now()}@mastering-da.com`;
const PASS = `Probe!${Math.random().toString(36).slice(2)}Aa1`;

async function main() {
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASS, email_confirm: true,
  });
  if (cErr) throw new Error(`tạo user test: ${cErr.message}`);
  const userId = created.user!.id;

  try {
    const sb = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: sErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
    if (sErr) throw new Error(`login: ${sErr.message}`);
    console.log("✅ Đăng nhập với role `authenticated` (đúng như app)\n");

    const t0 = Date.now();
    let t = Date.now();
    const { data: latest, error: e1 } = await sb.from("fact_lead_score")
      .select("scored_at").order("scored_at", { ascending: false }).limit(1).maybeSingle();
    console.log(`getLatestScoredAt: ${Date.now() - t}ms   err=${e1?.message ?? "-"}`);
    const scoredAt = latest?.scored_at;
    if (!scoredAt) { console.log("❌ Không lấy được scored_at → trang sẽ lỗi"); return; }

    t = Date.now();
    const scores: { lead_id: string }[] = [];
    let from = 0;
    while (from < 10000) {
      const { data, error } = await sb.from("fact_lead_score")
        .select("*").eq("scored_at", scoredAt).gte("hot_score", 70).lte("hot_score", 100)
        .order("hot_score", { ascending: false }).range(from, from + 999);
      if (error) { console.log(`  ❌ ${error.message}`); break; }
      if (!data?.length) break;
      scores.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
    console.log(`fetch scores:      ${Date.now() - t}ms   ${scores.length} lead NÓNG`);

    const ids = scores.map(s => s.lead_id);
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));

    t = Date.now();
    const pages = await Promise.all(batches.map(b => sb.from("dim_lead").select("*").in("lead_id", b)));
    const rows = pages.reduce((n, p) => n + (p.data?.length ?? 0), 0);
    const err = pages.find(p => p.error)?.error?.message;
    console.log(`joinLeads:         ${Date.now() - t}ms   ${rows} rows   err=${err ?? "-"}`);

    t = Date.now();
    const pp = await Promise.all(batches.map(b =>
      sb.from("dim_lead").select("sf_product").in("lead_id", b).not("sf_product", "is", null)));
    console.log(`getTopHotProducts: ${Date.now() - t}ms   err=${pp.find(p => p.error)?.error?.message ?? "-"}`);

    t = Date.now();
    const { data: views } = await sb.from("dim_list_view").select("view_id").eq("sf_object_type", "Lead");
    for (const v of views ?? []) {
      await sb.from("fact_list_view_member").select("lead_id").eq("view_id", v.view_id).range(0, 999);
    }
    console.log(`getHotListViews:   ${Date.now() - t}ms   ${views?.length} views`);

    const total = Date.now() - t0;
    console.log(`\n${"─".repeat(50)}`);
    console.log(`TỔNG: ${total}ms   → ${total < 10000 ? "✅ TRANG CHẠY ĐƯỢC" : "❌ VẪN QUÁ CHẬM"}`);
  } finally {
    await admin.auth.admin.deleteUser(userId);
    console.log("\n(đã xoá user test)");
  }
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
