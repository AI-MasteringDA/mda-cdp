import { admin as _a } from "../lib/supabase-admin";
void _a;
const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BASE = "https://api.smax.ai";
const BIZ = "mastering-data-analytics";

async function main() {
  // Lấy 1 customer có tag Hot Lead, xem cấu trúc tags
  const res = await fetch(`${BASE}/bizs/${BIZ}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 2000 }),
  }).then(r => r.json()) as { data?: Array<Record<string, unknown>> };

  const withHot = (res.data ?? []).find(c => {
    const tags = c.tags as Array<{ name?: string }> | undefined;
    return tags?.some(t => (t?.name ?? "").toLowerCase().includes("hot"));
  });

  if (!withHot) { console.log("Không tìm thấy customer có tag Hot trong 2000 đầu"); return; }
  console.log("Customer:", withHot.name ?? withHot.profile_name);
  console.log("\nCấu trúc tags (SMAX TRẢ VỀ gì):");
  console.log(JSON.stringify(withHot.tags, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
