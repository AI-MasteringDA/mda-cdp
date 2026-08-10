/**
 * /radar â€” Sales Lead Radar: dashboard lead SMAX (KPI theo ká»³, trend, kÃªnh,
 * BI/FA, danh sÃ¡ch chi tiáº¿t). Dashboard lÃ  1 trang self-contained trong
 * public/radar.html (SVG thuáº§n, khÃ´ng thÆ° viá»‡n) â€” nhÃºng iframe Ä‘á»ƒ giá»¯ nguyÃªn
 * layout fit-mÃ n-hÃ¬nh mÃ  váº«n náº±m trong app (sidebar + auth cá»§a CDP).
 * Data: /api/radar (Ä‘á»c Lark SMAX_Database, filter 40 ngÃ y).
 *
 * `?v=` lÃ  sá»‘ phiÃªn báº£n chá»‘ng cache â€” TÄ‚NG má»—i láº§n sá»­a public/radar.html,
 * náº¿u khÃ´ng trÃ¬nh duyá»‡t váº«n giá»¯ báº£n cÅ© vÃ  tÆ°á»Ÿng lÃ  dashboard há»ng.
 */
const RADAR_VERSION = 11;

export const metadata = { title: "Sales Radar Â· MDA Platform" };

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
