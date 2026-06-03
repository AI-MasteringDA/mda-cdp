export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div style={{ padding: 40, fontFamily: "system-ui" }}>
      <h1>BARE BONES TEST</h1>
      <p>If you see this, framework + auth + layout all work.</p>
      <p>Build version: v3 minimal</p>
      <ul style={{ marginTop: 20 }}>
        <li><a href="/dashboard/funnel">→ /dashboard/funnel</a></li>
        <li><a href="/dashboard/sales">→ /dashboard/sales</a></li>
        <li><a href="/dashboard/marketing">→ /dashboard/marketing</a></li>
        <li><a href="/dashboard/trends">→ /dashboard/trends</a></li>
        <li><a href="/leads">→ /leads</a></li>
      </ul>
    </div>
  );
}
