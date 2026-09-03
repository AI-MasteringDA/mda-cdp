/**
 * /radar — Sales Lead Radar: dashboard lead SMAX (KPI theo kỳ, trend, kênh,
 * BI/FA, danh sách chi tiết). Dashboard là 1 trang self-contained trong
 * public/radar.html (SVG thuần, không thư viện) — nhúng iframe để giữ nguyên
 * layout fit-màn-hình mà vẫn nằm trong app (sidebar + auth của CDP).
 * Data: /api/radar (đọc Lark SMAX_Database, filter 40 ngày).
 *
 * `?v=` là số phiên bản chống cache — TĂNG mỗi lần sửa public/radar.html,
 * nếu không trình duyệt vẫn giữ bản cũ và tưởng là dashboard hỏng.
 * LƯU Ý: đừng sửa file này bằng PowerShell Set-Content (làm hỏng font tiếng Việt).
 */
const RADAR_VERSION = 32;

export const metadata = { title: "Sales Radar · MDA Platform" };

// Chuyển tiếp query param sang iframe — dùng cho deep-link từ báo cáo Lark,
// VD /radar?days=1&grp=bi mở thẳng đúng kỳ "Hôm qua" + lọc BI (xem đoạn
// "DEEP LINK" trong radar.html). `v` không cho đè — luôn dùng đúng bản build.
export default async function RadarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "v" || v == null) continue;
    qs.set(k, Array.isArray(v) ? v[0] ?? "" : v);
  }
  qs.set("v", String(RADAR_VERSION));
  return (
    <iframe
      src={`/radar.html?${qs.toString()}`}
      title="Sales Lead Radar"
      className="w-full border-0"
      style={{ height: "100vh", display: "block" }}
    />
  );
}
