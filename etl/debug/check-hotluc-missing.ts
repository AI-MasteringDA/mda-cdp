/**
 * Quét SMAX_Database: lead nào có tag "Hot Lead" trong "Tag SMAX" mà cột
 * "Hot Lead lúc" lại TRỐNG? Điều tra theo yêu cầu user 2026-08-13 — cột này
 * quan trọng cho pipeline (deep-link am/pm dùng haMs = "Hot Lead lúc").
 * Chạy: npx tsx etl/debug/check-hotluc-missing.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const LID = process.env.LARK_APP_ID || "", LSEC = process.env.LARK_APP_SECRET || "", LAPP = process.env.LARK_BASE_APP_TOKEN || "";
const LU = "https://open.larksuite.com/open-apis";
const TID = "tbl1CLj7bn0dAe7o"; // SMAX_Database

const txt = (v: any) => Array.isArray(v) ? v.map((x: any) => x?.text ?? "").join("") : (v == null ? "" : String(v));
const lst = (v: any) => Array.isArray(v) ? v.map((x: any) => typeof x === "object" && x ? (x.text ?? x.name ?? "") : String(x)).filter(Boolean) : [];
const vnMs = (ms: any) => typeof ms === "number" ? new Date(ms + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "-";
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

async function main() {
  const a = await fetch(`${LU}/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: LID, app_secret: LSEC }) }).then(r => r.json());
  const H = { Authorization: `Bearer ${a.tenant_access_token}` };

  const rows: any[] = []; let pt: string | undefined;
  while (true) {
    const u = new URL(`${LU}/bitable/v1/apps/${LAPP}/tables/${TID}/records`); u.searchParams.set("page_size", "500");
    u.searchParams.set("field_names", JSON.stringify(["Lead ID", "Lead Name", "Tag SMAX", "Hot Lead lúc", "Ngày chat đầu", "Báo cáo ngày", "Communication Channels", "Phone", "ID", "Lần cập nhật cuối"]));
    if (pt) u.searchParams.set("page_token", pt);
    const d = await fetch(u.toString(), { headers: H }).then(r => r.json());
    if (d.code !== 0) { console.log("Lark lỗi", d.code, d.msg); break; }
    rows.push(...(d.data?.items || []).map((r: any) => ({ id: r.record_id, ...r.fields })));
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  console.log(`Tổng dòng SMAX_Database: ${rows.length}`);

  const hotTagged = rows.filter(f => lst(f["Tag SMAX"]).some(t => norm(t) === "hotlead"));
  console.log(`Số dòng có tag "Hot Lead" trong Tag SMAX: ${hotTagged.length}`);

  const missing = hotTagged.filter(f => typeof f["Hot Lead lúc"] !== "number");
  console.log(`Số dòng có tag Hot Lead nhưng "Hot Lead lúc" TRỐNG: ${missing.length}\n`);

  if (missing.length) {
    console.log("Danh sách (tối đa 40 dòng đầu):");
    for (const f of missing.slice(0, 40)) {
      console.log(`  - "${txt(f["Lead Name"])}" | LeadID=${txt(f["Lead ID"])} | ID=${txt(f["ID"])} | Ngày chat đầu=${vnMs(f["Ngày chat đầu"])} | Báo cáo ngày=${vnMs(f["Báo cáo ngày"])} | Lần cập nhật cuối=${vnMs(f["Lần cập nhật cuối"])} | Kênh=${JSON.stringify(lst(f["Communication Channels"]))}`);
    }
    if (missing.length > 40) console.log(`  ... còn ${missing.length - 40} dòng nữa`);
  }
  process.exit(0);
}
main();
