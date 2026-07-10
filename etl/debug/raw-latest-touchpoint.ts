import { admin } from "../lib/supabase-admin";

async function main() {
  try {
    const { data, error } = await admin.from("fact_touchpoint")
      .select("occurred_at, event_type, title, source")
      .eq("source", "smax")
      .order("occurred_at", { ascending: false })
      .limit(10);
    if (error) console.error("ERR:", error.message);
    else if (!data?.length) console.log("(empty)");
    else {
      console.log(`10 latest SMAX touchpoints:`);
      data.forEach((r, i) => console.log(`  ${i+1}. ${r.occurred_at}  [${r.event_type}]  ${(r.title || "").slice(0, 60)}`));
    }
  } catch (e) {
    console.error("EXC:", (e as Error).message);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
