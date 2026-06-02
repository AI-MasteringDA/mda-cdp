import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const TOKEN = process.env.SMAX_USER_TOKEN || process.env.SMAX_API_KEY!;
const BASE = "https://api.smax.ai";
const BIZ_SLUG = "mastering-data-analytics";

const PAGE_PIDS = [
  "fb102323788540150",
  "fb107203051058856",
  "zlw543187459113764384",
  "ctm68188e11779d16c0779c018c",
  "ig17841446528067260",
  "ig17841460097450702",
  "zl2235256473219383054",
];

async function probePost(path: string, body: unknown) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ct = res.headers.get("content-type") || "";
    let data: unknown = null;
    if (ct.includes("json")) data = await res.json();
    else data = (await res.text()).slice(0, 200);
    return { status: res.status, data, size: (typeof data === "object" ? JSON.stringify(data).length : 0) };
  } catch (e) {
    return { status: 0, data: `error: ${(e as Error).message}`, size: 0 };
  }
}

const BODIES = [
  { label: "empty", body: {} },
  { label: "limit only", body: { limit: 5 } },
  { label: "limit+skip", body: { limit: 5, skip: 0 } },
  { label: "page_pids array", body: { page_pids: PAGE_PIDS, limit: 5 } },
  { label: "sort + limit", body: { sort: { updated_at: -1 }, limit: 5 } },
  { label: "filter empty", body: { filter: {}, limit: 5 } },
  { label: "biz_id + limit", body: { biz_id: "680f0fe94a0804d7b6a2deef", limit: 5 } },
];

async function main() {
  console.log("=== POST /bizs/{slug}/threads — body shape discovery ===\n");

  for (const t of BODIES) {
    const r = await probePost(`/bizs/${BIZ_SLUG}/threads`, t.body);
    const icon = (r.status === 200 || r.status === 201) ? "✅" : r.status === 400 ? "⚠️ " : r.status === 404 ? "  " : "❌";
    let preview = "";
    if (r.size > 1000) preview = `LARGE response (${(r.size / 1024).toFixed(1)}KB)`;
    else if (typeof r.data === "object" && r.data !== null) {
      const obj = r.data as Record<string, unknown>;
      const keys = Object.keys(obj).slice(0, 5).join(", ");
      preview = `[${keys}]`;
      const msg = obj.message;
      if (msg && (r.status >= 400 || keys.includes("message"))) {
        preview = String(msg).slice(0, 80);
      }
    }
    console.log(`${icon} ${String(r.status).padStart(3)}  body=${t.label.padEnd(20)} ${preview}`);
  }

  // Also try /customers same way
  console.log("\n\n=== POST /bizs/{slug}/customers ===\n");
  for (const t of BODIES) {
    const r = await probePost(`/bizs/${BIZ_SLUG}/customers`, t.body);
    const icon = (r.status === 200 || r.status === 201) ? "✅" : r.status === 400 ? "⚠️ " : r.status === 404 ? "  " : "❌";
    let preview = "";
    if (r.size > 1000) preview = `LARGE response (${(r.size / 1024).toFixed(1)}KB)`;
    else if (typeof r.data === "object" && r.data !== null) {
      const obj = r.data as Record<string, unknown>;
      const keys = Object.keys(obj).slice(0, 5).join(", ");
      preview = `[${keys}]`;
      const msg = obj.message;
      if (msg && r.status >= 400) preview = String(msg).slice(0, 80);
    }
    console.log(`${icon} ${String(r.status).padStart(3)}  body=${t.label.padEnd(20)} ${preview}`);
  }

  // Detail the largest threads response
  console.log("\n\n=== DETAIL largest threads response ===\n");
  for (const t of BODIES) {
    const r = await probePost(`/bizs/${BIZ_SLUG}/threads`, t.body);
    if ((r.status === 200 || r.status === 201) && r.size > 500) {
      console.log(`\n🎯 body=${t.label}:`);
      const str = JSON.stringify(r.data, null, 2);
      console.log(str.length > 3000 ? str.slice(0, 3000) + "\n...(truncated)" : str);
      break;
    }
  }
}

main().catch(console.error);
