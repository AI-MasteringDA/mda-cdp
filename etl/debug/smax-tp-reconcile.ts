import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

function extractContact(text: string) {
  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch?.[0]?.toLowerCase() || null;
  const cleaned = text.replace(/[\s\-()]/g, "");
  let phoneMatch: RegExpMatchArray | null =
    cleaned.match(/\+84(3|5|7|8|9)\d{8}/) ||
    cleaned.match(/0(3|5|7|8|9)\d{8}/) ||
    cleaned.match(/(?<!\d)(3|5|7|8|9)\d{8}(?!\d)/);
  let phone: string | null = null;
  if (phoneMatch) {
    phone = phoneMatch[0].replace(/^\+84/, "0");
    if (phone.length === 9) phone = "0" + phone;
  }
  return { email, phone };
}

async function main() {
  console.log("🔧 Reconcile SMAX touchpoints — link to correct lead via payload.smax_customer_id\n");

  // 1. Load all SMAX touchpoints
  const tps: { id: string; lead_id: string; title: string; payload: Record<string, unknown> }[] = [];
  let from = 0;
  while (true) {
    const { data } = await s.from("fact_touchpoint").select("id, lead_id, title, payload").eq("source", "smax").range(from, from + 999);
    if (!data?.length) break;
    tps.push(...data as typeof tps);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Loaded ${tps.length} SMAX touchpoints`);

  // 2. Build smax_customer_id → correct lead_id map
  const custMap = new Map<string, string>();
  from = 0;
  while (true) {
    const { data } = await s.from("dim_lead").select("lead_id, smax_customer_id").not("smax_customer_id", "is", null).range(from, from + 999);
    if (!data?.length) break;
    for (const l of data) if (l.smax_customer_id) custMap.set(l.smax_customer_id, l.lead_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Loaded ${custMap.size} leads with smax_customer_id`);

  // 3. Reconcile: for each tp, check if payload.smax_customer_id points to a different lead
  let reassigned = 0;
  let alreadyOk = 0;
  let missingCustLead = 0;
  const needNewLead: typeof tps = [];

  for (const tp of tps) {
    const custId = (tp.payload?.smax_customer_id as string) || null;
    if (!custId) { alreadyOk++; continue; }
    const correctLeadId = custMap.get(custId);
    if (!correctLeadId) {
      needNewLead.push(tp);
      missingCustLead++;
      continue;
    }
    if (correctLeadId === tp.lead_id) { alreadyOk++; continue; }
    // Reassign
    const { error } = await s.from("fact_touchpoint").update({ lead_id: correctLeadId }).eq("id", tp.id);
    if (!error) reassigned++;
  }
  console.log(`\n✅ Reassigned:      ${reassigned} touchpoints`);
  console.log(`   Already correct: ${alreadyOk}`);
  console.log(`   Missing lead:    ${missingCustLead} (need to create lead for these)\n`);

  // 4. Create leads for missing customer_ids
  if (needNewLead.length > 0) {
    console.log(`Creating leads for ${needNewLead.length} orphan touchpoints...`);

    // Group by smax_customer_id
    const bySmaxId = new Map<string, { title: string; tp_ids: string[] }>();
    for (const tp of needNewLead) {
      const cid = tp.payload?.smax_customer_id as string;
      if (!bySmaxId.has(cid)) bySmaxId.set(cid, { title: tp.title, tp_ids: [] });
      bySmaxId.get(cid)!.tp_ids.push(tp.id);
    }

    const AVATAR_COLORS = ["#FFE5D9","#FFE3F0","#E0F2FE","#DCFCE7","#FEF3C7","#EDE9FE","#FCE7F3","#E0E7FF","#FED7E2","#D1FAE5"];
    const pickColor = (seed: string) => {
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
      return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
    };

    let createdLeads = 0, updatedTps = 0;
    for (const [cid, info] of bySmaxId) {
      // Extract name from title: "Chat: Actual Name_..." or "TVV chat: Actual Name..."
      const nameFromTitle = info.title.replace(/^(TVV chat|Chat): /, "").replace(/:.*/, "").slice(0, 100);
      const { email, phone } = extractContact(info.title);

      const { data: newLead, error } = await s.from("dim_lead").insert({
        smax_customer_id: cid,
        full_name: nameFromTitle || `Anonymous (smax)`,
        email, phone,
        source: "smax",
        stage: "Mới",
        avatar_color: pickColor(cid),
        first_seen_at: new Date().toISOString(),
      }).select("lead_id").single();

      if (error || !newLead) continue;
      createdLeads++;
      // Reassign all its touchpoints
      const { error: upErr } = await s.from("fact_touchpoint").update({ lead_id: newLead.lead_id }).in("id", info.tp_ids);
      if (!upErr) updatedTps += info.tp_ids.length;
    }
    console.log(`   Created ${createdLeads} new leads, reassigned ${updatedTps} touchpoints\n`);
  }

  // Final stats
  const { count: total } = await s.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", "smax");
  const { count: withEither } = await s.from("dim_lead").select("*", { count: "exact", head: true }).eq("source", "smax").or("email.not.is.null,phone.not.is.null");
  console.log(`📊 SMAX identifier coverage: ${withEither}/${total} (${Math.round(withEither!/total!*100)}%)`);
}
main().catch(console.error);
