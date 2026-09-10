/**
 * DỌN DÒNG TRÙNG trong bảng Lark "Salesforce_Database".
 *
 * VÌ SAO CÓ TRÙNG: hai job cùng ghi vào bảng này với hai khoá chống trùng khác
 * nhau — sf-lark-bridge dùng `Time|Event|Tên SF`, còn lark-push dùng
 * `Time|Event|Lead Name|Title`. Mỗi bên không nhìn thấy dòng của bên kia nên
 * cùng một sự kiện bị ghi hai lần. lark-push đã tắt 2026-09-08, nhưng phần đã
 * sinh ra vẫn nằm đó.
 *
 * CÁCH GOM: cùng `Event` + cùng `Time` + cùng người. Người nhận diện theo thứ
 * tự ưu tiên: SĐT 9 số cuối → email → tên đã bỏ dấu.
 *
 * ⚠ VỚI email_sent PHẢI THÊM `Title` VÀO KHOÁ. Cột Time của loại sự kiện này
 * lưu ở mốc 00:00 (theo NGÀY, không phải theo giây), nên nếu chỉ gom theo
 * Event+Time+người thì MỌI email gửi cho một người trong cùng một ngày bị coi
 * là một — đo 2026-09-10: 453/619 nhóm thực ra là các email KHÁC NHAU (thư mời
 * khoá học và thư xác nhận thanh toán cùng ngày). Xoá theo khoá đó là mất dữ
 * liệu thật.
 *
 * Ngược lại lead_created KHÔNG được đưa Title vào khoá: hai job ghi Title khác
 * nhau ("" của sf-lark-bridge và "🚪 Tạo Lead trong Salesforce" của lark-push)
 * — chính là chỗ khiến chúng nhân đôi.
 *
 * GIỮ DÒNG NÀO: dòng nhiều thông tin hơn cho phần app đang đọc — ưu tiên có
 * "Khoá (SF)", "Rating (SF)", "Tên SF". Hoà thì giữ dòng tạo trước.
 *
 * Chạy thử (KHÔNG xoá):  npx tsx etl/debug/clean-sf-dup.ts
 * Xoá thật:              npx tsx etl/debug/clean-sf-dup.ts --xoa
 * Luôn ghi bản sao lưu ra sf-dup-backup-<ngày>.json trước khi xoá.
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { writeFileSync } from "fs";

const U = "https://open.larksuite.com/open-apis";
const ID = process.env.LARK_APP_ID!, SEC = process.env.LARK_APP_SECRET!, APP = process.env.LARK_BASE_APP_TOKEN!;
const XOA = process.argv.includes("--xoa");

const gs = (v: unknown): string => Array.isArray(v)
  ? (v as { text?: string }[]).map(x => x?.text ?? "").join("") : (v == null ? "" : String(v));
const ph = (s: unknown) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; };
const em = (s: unknown) => String(s ?? "").toLowerCase().trim();
const nk = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();

type Row = { rid: string; f: Record<string, unknown> };

(async () => {
  const tk = (await fetch(`${U}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ID, app_secret: SEC }),
  }).then(r => r.json())).tenant_access_token;
  const H = { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" };

  const t = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H }).then(r => r.json());
  const tbl = t.data.items.find((x: { name: string }) => x.name === "Salesforce_Database")?.table_id;
  if (!tbl) { console.log("không thấy bảng Salesforce_Database"); return }

  const rows: Row[] = [];
  let pt: string | undefined;
  while (true) {
    const u = new URL(`${U}/bitable/v1/apps/${APP}/tables/${tbl}/records`);
    u.searchParams.set("page_size", "500");
    if (pt) u.searchParams.set("page_token", pt);
    const d = await fetch(u.toString(), { headers: H }).then(r => r.json());
    if (d.code !== 0) throw new Error(`đọc lỗi ${d.code} ${d.msg}`);
    for (const r of (d.data?.items ?? [])) rows.push({ rid: r.record_id, f: r.fields ?? {} });
    if (!d.data?.has_more) break; pt = d.data.page_token;
  }
  console.log(`Tổng ${rows.length} dòng trong Salesforce_Database\n`);

  // gom theo (Event | Time | người)
  const nhom = new Map<string, Row[]>();
  for (const r of rows) {
    const f = r.f;
    const time = typeof f["Time"] === "number" ? f["Time"] as number : 0;
    if (!time) continue;                       // không có mốc thời gian thì không dám gom
    const ai = ph(gs(f["Phone"])) || em(gs(f["Email"])) || nk(gs(f["Tên SF"]) || gs(f["Lead Name"]));
    if (!ai) continue;                          // không nhận diện được người thì bỏ qua
    const ev = gs(f["Event"]);
    // lead_created: bỏ Title ra khỏi khoá (hai job ghi khác nhau).
    // Loại khác: PHẢI có Title, vì Time chỉ chính xác tới ngày.
    const k = ev === "lead_created"
      ? `${ev}|${time}|${ai}`
      : `${ev}|${time}|${ai}|${gs(f["Title"]).slice(0, 80)}`;
    (nhom.get(k) ?? nhom.set(k, []).get(k)!).push(r);
  }

  // trong mỗi nhóm: giữ dòng đủ thông tin nhất
  const diem = (r: Row) => (gs(r.f["Khoá (SF)"]) ? 4 : 0) + (gs(r.f["Rating (SF)"]) ? 2 : 0)
    + (gs(r.f["Tên SF"]) ? 1 : 0);
  const xoa: Row[] = []; const theoEvent: Record<string, number> = {};
  for (const [, a] of nhom) {
    if (a.length < 2) continue;
    const sap = [...a].sort((x, y) => diem(y) - diem(x));
    for (const r of sap.slice(1)) {
      xoa.push(r);
      const e = gs(r.f["Event"]) || "(trống)";
      theoEvent[e] = (theoEvent[e] || 0) + 1;
    }
  }

  console.log(`Nhóm có từ 2 dòng trở lên: ${[...nhom.values()].filter(a => a.length > 1).length}`);
  console.log(`DÒNG THỪA cần xoá: ${xoa.length}\n`);
  console.log("Theo loại sự kiện:");
  for (const [e, n] of Object.entries(theoEvent).sort((a, b) => b[1] - a[1]))
    console.log(`  ${e.padEnd(16)} ${String(n).padStart(5)}`);
  console.log(`\nCòn lại sau khi dọn: ${rows.length - xoa.length} dòng`);

  if (!XOA) {
    console.log("\n▶ Đây là CHẠY THỬ, chưa xoá gì. Thêm --xoa để xoá thật.");
    return;
  }

  const ten = `sf-dup-backup-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(ten, JSON.stringify(xoa, null, 1));
  console.log(`\n💾 Đã lưu bản sao ${xoa.length} dòng sắp xoá vào ${ten}`);

  let da = 0;
  for (let i = 0; i < xoa.length; i += 400) {
    const lo = xoa.slice(i, i + 400).map(r => r.rid);
    const rr = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${tbl}/records/batch_delete`, {
      method: "POST", headers: H, body: JSON.stringify({ records: lo }),
    }).then(r => r.json());
    if (rr.code !== 0) { console.log(`  ⚠ lô ${i / 400 + 1} lỗi: ${rr.code} ${rr.msg}`); continue }
    da += lo.length;
    console.log(`  đã xoá ${da}/${xoa.length}`);
  }
  console.log(`\n✅ Xong. Đã xoá ${da} dòng thừa.`);
})();
