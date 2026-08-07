/**
 * /radar — Sales Lead Radar: dashboard lead SMAX (KPI theo kỳ, trend, kênh,
 * BI/FA, danh sách chi tiết). Dashboard là 1 trang self-contained trong
 * public/radar.html (SVG thuần, không thư viện) — nhúng iframe để giữ nguyên
 * layout fit-màn-hình mà vẫn nằm trong app (sidebar + auth của CDP).
 * Data: /api/radar (đọc Lark SMAX_Database, filter 40 ngày).
 */
export const metadata = { title: "Sales Radar · MDA Platform" };

export default function RadarPage() {
  return (
    <iframe
      src="/radar.html"
      title="Sales Lead Radar"
      className="w-full border-0"
      style={{ height: "100vh", display: "block" }}
    />
  );
}
