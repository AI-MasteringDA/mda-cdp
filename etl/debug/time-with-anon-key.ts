/** Đo lại bằng ANON key + RLS — đúng như app chạy (khác service key của debug scripts). */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/^﻿/, "");
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim().replace(/^﻿/, "");
const sb = createClient(url, anon);

async function main() {
  let t = Date.now();
  const { data: latest, error: e0 } = await sb.from("fact_lead_score")
    .select("scored_at").order("scored_at", { ascending: false }).limit(1);
  console.log(`getLatestScoredAt: ${Date.now() - t}ms  err=${e0?.message ?? "-"}`);
  const scoredAt = latest?.[0]?.scored_at;

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
  console.log(`fetch scores: ${scores.length} rows in ${Date.now() - t}ms`);

  const ids = scores.map(s => s.lead_id);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));

  t = Date.now();
  const pages = await Promise.all(batches.map(b => sb.from("dim_lead").select("*").in("lead_id", b)));
  const rows = pages.reduce((n, p) => n + (p.data?.length ?? 0), 0);
  const errs = pages.filter(p => p.error).map(p => p.error!.message);
  console.log(`joinLeads (${batches.length} batch song song): ${rows} rows in ${Date.now() - t}ms`);
  if (errs.length) console.log(`  ❌ ${errs.length} lỗi: ${errs[0]}`);

  t = Date.now();
  const pp = await Promise.all(batches.map(b =>
    sb.from("dim_lead").select("sf_product").in("lead_id", b).not("sf_product", "is", null)));
  console.log(`getTopHotProducts: ${Date.now() - t}ms  err=${pp.find(p => p.error)?.error?.message ?? "-"}`);

  t = Date.now();
  const { data: views } = await sb.from("dim_list_view").select("view_id").eq("sf_object_type", "Lead");
  let q = 0;
  for (const v of views ?? []) {
    let f = 0;
    while (true) {
      const { data: mem } = await sb.from("fact_list_view_member").select("lead_id").eq("view_id", v.view_id).range(f, f + 999);
      q++;
      if (!mem?.length || mem.length < 1000) break;
      f += 1000;
    }
  }
  console.log(`getHotListViews (${views?.length} views, ${q} queries): ${Date.now() - t}ms`);
}
main().catch(e => { console.error(e); process.exit(1); });
