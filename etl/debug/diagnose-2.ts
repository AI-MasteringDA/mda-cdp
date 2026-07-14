import { admin } from "../lib/supabase-admin";

async function main() {
  // 1. 1,348 lead smax còn lại: được tạo mới hay là survivor?
  const byMonth: Record<string, number> = {};
  let from = 0;
  const leadIds: string[] = [];
  while (from < 20000) {
    const { data } = await admin.from("dim_lead")
      .select("lead_id, first_seen_at").eq("source", "smax").range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) {
      leadIds.push(l.lead_id);
      const m = String(l.first_seen_at ?? "").slice(0, 7);
      if (m) byMonth[m] = (byMonth[m] ?? 0) + 1;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log("first_seen_at của 1,348 lead smax còn lại (theo tháng):");
  Object.entries(byMonth).sort().forEach(([m, n]) => console.log(`   ${m}: ${n}`));

  // 2. Có lead smax nào KHÔNG có touchpoint không? (nếu có → cascade chưa chạy)
  const withTp = new Set<string>();
  let f2 = 0;
  while (f2 < 30000) {
    const { data } = await admin.from("fact_touchpoint")
      .select("lead_id").eq("source", "smax").range(f2, f2 + 999);
    if (!data?.length) break;
    for (const t of data) if (t.lead_id) withTp.add(t.lead_id);
    if (data.length < 1000) break;
    f2 += 1000;
  }
  const orphanLeads = leadIds.filter(id => !withTp.has(id)).length;
  console.log(`\nLead smax không có touchpoint nào: ${orphanLeads}`);
  console.log(`(0 = có gì đó xoá lead-không-touchpoint → khớp hàm prune)`);

  // 3. raw_smax_chats còn không? (bảng raw, không bị cascade)
  const { count: raw } = await admin.from("raw_smax_chats").select("*", { count: "exact", head: true });
  console.log(`\nraw_smax_chats: ${raw ?? "(không có bảng)"} rows`);

  // 4. Salesforce/instantly có lead cũ không → prune 365 có chạy không
  const { count: sfOld } = await admin.from("fact_touchpoint")
    .select("*", { count: "exact", head: true })
    .eq("source", "salesforce").lt("occurred_at", "2025-07-14");
  console.log(`Salesforce touchpoint > 365 ngày tuổi: ${sfOld}  (>0 ⇒ prune 365d KHÔNG chạy)`);
}
main().catch(e => { console.error(e); process.exit(1); });
