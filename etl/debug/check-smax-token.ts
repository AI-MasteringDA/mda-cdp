/**
 * Kiểm tra token SMAX còn dùng được không — CHỈ ĐỌC, không ghi/không tạo gì.
 * Chạy sau khi cấp token mới để chắc chắn bridge sẽ chạy lại được:
 *   npx tsx etl/debug/check-smax-token.ts
 *
 * SMAX_USER_TOKEN là JWT sống 30 NGÀY. Hết hạn thì mọi lời gọi trả 401 và bridge
 * đứng im — đã xảy ra 03/09/2026, mất 4 ngày dữ liệu mới phát hiện.
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const BASE = process.env.SMAX_BASE_URL || "https://api.smax.ai";
const BIZ = "mastering-data-analytics";
const mask = (s?: string) => !s ? "(TRỐNG)" : `${s.slice(0, 3)}…${s.slice(-3)} · ${s.length} ký tự`;
const jwt = (t: string) => {
  try {
    const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
    const f = (k: string) => p[k] ? new Date(p[k] * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
    return { iat: f("iat"), exp: f("exp"), expMs: p.exp ? p.exp * 1000 : null, who: p.email || p.username || p.sub || p.user_id || p.id || "?" };
  } catch { return null }
};

(async () => {
  let ok = false;
  for (const name of ["SMAX_USER_TOKEN", "SMAX_API_KEY"]) {
    const T = process.env[name];
    console.log(`\n══════ ${name} ══════`);
    console.log("  ", mask(T));
    if (!T) { console.log("   ❌ không có trong .env.local"); continue }
    const d = jwt(T);
    if (d) {
      console.log("   chủ sở hữu :", d.who);
      console.log("   cấp lúc    :", d.iat);
      const left = d.expMs ? Math.floor((d.expMs - Date.now()) / 86400_000) : null;
      console.log("   hết hạn    :", d.exp, d.expMs ? (d.expMs < Date.now() ? "  ❌ ĐÃ HẾT HẠN" : `  ✅ còn ${left} ngày`) : "");
    } else console.log("   (không đọc được — không phải JWT chuẩn)");

    const r = await fetch(`${BASE}/bizs/${BIZ}/pages`, { headers: { Authorization: `Bearer ${T}` } });
    const b = await r.text(); let j: any = null; try { j = JSON.parse(b) } catch {}
    const items = j?.data ?? j?.pages;
    console.log(`   GET /pages → HTTP ${r.status} ${r.statusText}`,
      Array.isArray(items) ? `· ✅ ${items.length} page` : `· ${j?.message ?? b.slice(0, 80)}`);

    const r2 = await fetch(`${BASE}/bizs/${BIZ}/customers`, { method: "POST",
      headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" }, body: JSON.stringify({ size: 1 }) });
    const b2 = await r2.text(); let j2: any = null; try { j2 = JSON.parse(b2) } catch {}
    const good = Array.isArray(j2?.data) && j2.data.length > 0;
    console.log(`   POST /customers (size 1) → HTTP ${r2.status}`,
      good ? `· ✅ đọc được khách` : `· ${j2?.message ?? b2.slice(0, 80)}`);
    if (good) ok = true;
  }
  console.log(ok
    ? "\n✅ Có token dùng được — bridge sẽ chạy lại bình thường."
    : "\n⛔ KHÔNG token nào dùng được. Vào SMAX cấp token mới, rồi cập nhật SMAX_USER_TOKEN ở GitHub Secrets và .env.local.");
})();
