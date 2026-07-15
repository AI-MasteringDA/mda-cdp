import { admin } from "../lib/supabase-admin";
async function main() {
  // Tìm lead minh hoạ: tag Hot lâu nhưng chat gần đây, và ngược lại
  const { data: latest } = await admin.from("fact_lead_score").select("scored_at").order("scored_at",{ascending:false}).limit(1);
  const scoredAt = latest?.[0]?.scored_at;
  const hotIds: string[] = [];
  let from = 0;
  while (from < 5000) {
    const { data } = await admin.from("fact_lead_score").select("lead_id").eq("scored_at",scoredAt).gte("hot_score",70).range(from,from+999);
    if (!data?.length) break; hotIds.push(...data.map(d=>d.lead_id));
    if (data.length<1000) break; from+=1000;
  }

  let tagNewerThanChat = 0, chatNewerThanTag = 0, hasTag = 0;
  const examples: string[] = [];
  for (let i=0;i<hotIds.length;i+=100){
    const { data } = await admin.from("dim_lead")
      .select("full_name, last_engagement_at, hot_tag_at")
      .in("lead_id", hotIds.slice(i,i+100));
    for (const l of data ?? []) {
      if (!l.hot_tag_at) continue;
      hasTag++;
      const eng = l.last_engagement_at ? Date.parse(l.last_engagement_at) : 0;
      const tag = Date.parse(l.hot_tag_at);
      if (tag > eng + 86400000) { // tag mới hơn chat >1 ngày
        tagNewerThanChat++;
        if (examples.length < 4) examples.push(`  [tag mới hơn] ${String(l.full_name).slice(0,22).padEnd(22)} chat:${String(l.last_engagement_at).slice(0,10)}  tag:${l.hot_tag_at.slice(0,10)}`);
      } else if (eng > tag + 86400000) chatNewerThanTag++;
    }
  }
  console.log(`Lead NÓNG có hot_tag_at: ${hasTag}`);
  console.log(`  ├─ tag mới hơn tương tác:  ${tagNewerThanChat}  ← nhóm này TRƯỚC ĐÂY bị filter loại oan`);
  console.log(`  └─ tương tác mới hơn tag:  ${chatNewerThanTag}`);
  console.log(`\nVí dụ 'tag mới hơn chat' (hotAsOf sẽ lấy mốc tag, giữ lại khi lọc gần đây):`);
  examples.forEach(e=>console.log(e));
}
main().catch(e=>{console.error(e);process.exit(1);});
