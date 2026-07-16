import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY;
const BIZ = "mastering-data-analytics";
(async () => {
  const res = await fetch(`${BASE}/bizs/${BIZ}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 60 }),
  });
  const j: { data?: { name?: string; profile_name?: string; platform?: string; picture?: string; interaction?: { first?: string }; created_at?: string }[] } = await res.json();
  const rows = j.data || [];
  const withPic = rows.filter((c) => c.picture);
  console.log(`total pulled: ${rows.length}, có picture: ${withPic.length}`);
  console.log(`\n── mẫu interaction.first vs created_at (để sửa first_seen_at) ──`);
  for (const c of rows.slice(0, 3)) {
    console.log(`  ${c.name || c.profile_name}: interaction.first=${c.interaction?.first} created_at=${c.created_at}`);
  }
  console.log(`\n── mẫu picture URL ──`);
  for (const c of withPic.slice(0, 6)) {
    console.log(`\n${c.name || c.profile_name} [${c.platform}]`);
    console.log(`  ${c.picture}`);
  }
  // Thử tải 1 ảnh xem có 200 không (không kèm auth)
  if (withPic[0]?.picture) {
    try {
      const r = await fetch(withPic[0].picture, { method: "HEAD" });
      console.log(`\nHEAD ảnh đầu tiên: ${r.status} ${r.headers.get("content-type")}`);
    } catch (e) {
      console.log(`\nHEAD lỗi: ${(e as Error).message}`);
    }
  }
})();
