/**
 * Gửi tóm tắt "Hôm qua" vào group chat Lark bằng Custom Bot Webhook.
 *
 * Đọc thẳng từ bảng Daily_Report (đã được etl:daily:report cập nhật mỗi giờ,
 * xem daily-report.ts) — không tính lại, chỉ lấy dòng của NGÀY HÔM QUA (giờ VN)
 * rồi format thành thẻ (interactive card) gửi qua webhook.
 *
 * CẦN: biến môi trường LARK_DAILY_WEBHOOK — URL của Custom Bot trong group Lark
 * muốn nhận tin. Cách lấy:
 *   1. Mở group Lark → biểu tượng ⚙️ (Cài đặt nhóm) → "Bot" / "Nhóm bot"
 *   2. "Thêm bot" → "Custom Bot" (Bot tuỳ chỉnh)
 *   3. Đặt tên bot (VD "MDA Lead Radar"), lưu lại → Lark cho ra 1 URL dạng
 *      https://open.larksuite.com/open-apis/bot/v2/hook/xxxxxxxx-xxxx-...
 *   4. Copy URL đó, đặt làm secret LARK_DAILY_WEBHOOK trên GitHub repo
 *      (Settings → Secrets and variables → Actions → New repository secret)
 *
 * Chạy: npm run etl:lark:daily
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const ID = process.env.LARK_APP_ID || "", SEC = process.env.LARK_APP_SECRET || "", APP = process.env.LARK_BASE_APP_TOKEN || "";
const WEBHOOK = process.env.LARK_DAILY_WEBHOOK || "";
const U = "https://open.larksuite.com/open-apis";
const TABLE = "Daily_Report";
const DASH_URL = process.env.RADAR_DASHBOARD_URL || "https://mda-cdp.vercel.app/radar";

const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const fmtVN = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

async function main() {
  if (!WEBHOOK) {
    console.log("[lark-daily] thiếu LARK_DAILY_WEBHOOK — xem hướng dẫn ở đầu file. Bỏ qua, không gửi.");
    return;
  }
  if (!ID || !APP) { console.log("[lark-daily] thiếu creds Lark Base, bỏ qua"); return; }

  const tk = await fetch(`${U}/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: ID, app_secret: SEC }),
  }).then(r => r.json()).then(j => j.tenant_access_token);
  const H = { Authorization: `Bearer ${tk}` };

  const tR = await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`, { headers: H }).then(r => r.json());
  const tid = tR.data?.items?.find((t: { name: string; table_id: string }) => t.name === TABLE)?.table_id;
  if (!tid) { console.log(`[lark-daily] không thấy bảng "${TABLE}" — chạy etl:daily:report trước`); return; }

  const yday = addDays(vnToday(), -1);
  const ydayMs = new Date(yday + "T00:00:00Z").getTime() - 7 * 3600_000;

  const d = await fetch(`${U}/bitable/v1/apps/${APP}/tables/${tid}/records/search`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({
      filter: { conjunction: "and", conditions: [{ field_name: "Báo cáo ngày", operator: "is", value: ["ExactDate", String(ydayMs)] }] },
    }),
  }).then(r => r.json());

  const row = d.data?.items?.[0]?.fields as Record<string, number> | undefined;
  if (!row) { console.log(`[lark-daily] không có dữ liệu cho ngày ${yday} trong ${TABLE}`); return; }

  const g = (k: string) => Number(row[k] ?? 0);
  const line = (label: string, v: number) => `**${label}:** ${v}`;

  const card = {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: `📊 Báo cáo lead — ${fmtVN(yday)}` },
        template: "blue",
      },
      elements: [
        {
          tag: "div",
          fields: [
            { is_short: true, text: { tag: "lark_md", content: line("Lead mới", g("Lead mới")) } },
            { is_short: true, text: { tag: "lark_md", content: line("🔥 Hot", g("Hot")) } },
            { is_short: true, text: { tag: "lark_md", content: line("Cold", g("Cold")) } },
            { is_short: true, text: { tag: "lark_md", content: line("Warm", g("Warm")) } },
            { is_short: true, text: { tag: "lark_md", content: line("Prospect", g("Prospect")) } },
            { is_short: true, text: { tag: "lark_md", content: line("Hot từ SF", g("Hot (SF)")) } },
          ],
        },
        { tag: "hr" },
        {
          tag: "div",
          text: { tag: "lark_md", content: `BI: Hot ${g("Hot (BI)")} · Cold ${g("Cold (BI)")} · Warm ${g("Warm (BI)")} · Prospect ${g("Prospect (BI)")}\nFA: Hot ${g("Hot (FA)")} · Cold ${g("Cold (FA)")} · Warm ${g("Warm (FA)")} · Prospect ${g("Prospect (FA)")}` },
        },
        {
          tag: "action",
          actions: [{ tag: "button", text: { tag: "plain_text", content: "Mở Dashboard" }, type: "primary", url: DASH_URL }],
        },
      ],
    },
  };

  const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) }).then(r => r.json());
  if (r.code === 0 || r.StatusCode === 0) console.log(`[lark-daily] đã gửi báo cáo ngày ${yday} vào group`);
  else console.log(`[lark-daily] gửi lỗi: ${JSON.stringify(r)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
