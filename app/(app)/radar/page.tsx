/**
 * /radar — Sales Lead Radar: dashboard lead SMAX (KPI theo kỳ, trend, kênh,
 * BI/FA, danh sách chi tiết). Dashboard là 1 trang self-contained trong
 * public/radar.html (SVG thuần, không thư viện) — nhúng iframe để giữ nguyên
 * layout fit-màn-hình mà vẫn nằm trong app (sidebar + auth của CDP).
 * Data: /api/radar (đọc Lark SMAX_Database, filter 40 ngày).
 *
 * `?v=` là số phiên bản chống cache — TĂNG mỗi lần sửa public/radar.html,
 * nếu không trình duyệt vẫn giữ bản cũ và tưởng là dashboard hỏng.
 */
const RADAR_VERSION = 10;

export const metadata = { title: "Sales Radar · MDA Platform" };

export default function RadarPage() {
  return (
    <iframe
      src={`/radar.html?v=${RADAR_VERSION}`}
      title="Sales Lead Radar"
      className="w-full border-0"
      style={{ height: "100vh", display: "block" }}
    />
  );
}
