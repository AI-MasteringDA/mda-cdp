/**
 * Sửa 1 LẦN: lead_created của Salesforce đang lấy Contact.CreatedDate (= ngày
 * CONVERT) thay vì CreatedDate của Lead gốc → sai ngày báo cáo.
 * Chạy: npx tsx etl/debug/fix-sf-created.ts [--apply]
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";
const IU=process.env.SALESFORCE_INSTANCE_URL,CI=process.env.SALESFORCE_CLIENT_ID||"",CS=process.env.SALESFORCE_CLIENT_SECRET||"";
const APPLY=process.argv.includes("--apply");
const vn=(x:any)=>x?new Date(new Date(x).getTime()+7*3600*1000).toISOString().slice(0,16):"-";
async function main(){
  const body=new URLSearchParams({grant_type:"client_credentials",client_id:CI,client_secret:CS});
  const tok=await fetch(`${IU}/services/oauth2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}).then(r=>r.json());
  const H={Authorization:`Bearer ${tok.access_token}`};
  const q=async(soql:string)=>{const r=await fetch(`${IU}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,{headers:H}).then(r=>r.json());return r.records||[]};
  // map contactId → Lead.CreatedDate (sớm nhất)
  const map=new Map<string,string>();
  let done=false,last="2000-01-01T00:00:00Z";
  while(!done){
    const rows=await q(`SELECT Id,ConvertedContactId,CreatedDate FROM Lead WHERE IsConverted = true AND CreatedDate > ${last} ORDER BY CreatedDate ASC LIMIT 2000`);
    for(const r of rows){if(!r.ConvertedContactId)continue;const p=map.get(r.ConvertedContactId);if(!p||r.CreatedDate<p)map.set(r.ConvertedContactId,r.CreatedDate);}
    if(rows.length<2000)done=true;else last=rows[rows.length-1].CreatedDate;
  }
  console.log(`Lead đã convert có ContactId: ${map.size}`);
  // duyệt touchpoint lead_created có sf_contact_id
  let from=0,checked=0,wrong=0,fixed=0;const ex:string[]=[];
  while(from<60000){
    const {data}=await admin.from("fact_touchpoint").select("id,lead_id,occurred_at,payload,title,detail").eq("source","salesforce").eq("event_type","lead_created").range(from,from+999);
    if(!data?.length)break;
    for(const r of data){
      const cid=(r.payload as any)?.sf_contact_id; if(!cid)continue; checked++;
      const real=map.get(cid); if(!real)continue;
      if(new Date(real).getTime()===new Date(r.occurred_at).getTime())continue;
      wrong++;
      if(ex.length<6)ex.push(`  ${vn(r.occurred_at)} → ${vn(real)}`);
      if(APPLY){const {error}=await admin.from("fact_touchpoint").update({occurred_at:real,title:"🚪 Tạo Lead trong Salesforce",detail:(r.detail||"")+" · (lead đã convert)"}).eq("id",r.id);if(!error)fixed++;}
    }
    if(data.length<1000)break;from+=1000;
  }
  console.log(`Touchpoint từ Contact: ${checked} | SAI ngày: ${wrong} | đã sửa: ${fixed}${APPLY?"":" (chạy thử — thêm --apply để ghi)"}`);
  ex.forEach(e=>console.log(e));
  process.exit(0);
}
main();
