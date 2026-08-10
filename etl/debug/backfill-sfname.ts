/**
 * Điền "tên bên Salesforce" cho dữ liệu cũ: bổ sung payload.sf_name vào
 * fact_touchpoint (lead_created của SF), rồi ghi cột "Tên SF" trên Lark.
 * Chạy: npx tsx etl/debug/backfill-sfname.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";
const IU=process.env.SALESFORCE_INSTANCE_URL,CI=process.env.SALESFORCE_CLIENT_ID||"",CS=process.env.SALESFORCE_CLIENT_SECRET||"";
const ID=process.env.LARK_APP_ID||"",SEC=process.env.LARK_APP_SECRET||"",APP=process.env.LARK_BASE_APP_TOKEN||"";
const U="https://open.larksuite.com/open-apis";
const txt=(v:any)=>Array.isArray(v)?v.map((x:any)=>x?.text??"").join(""):(v==null?"":String(v));
async function main(){
  const body=new URLSearchParams({grant_type:"client_credentials",client_id:CI,client_secret:CS});
  const tok=await fetch(`${IU}/services/oauth2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}).then(r=>r.json());
  const SH={Authorization:`Bearer ${tok.access_token}`};
  const sfq=async(s:string)=>{const r=await fetch(`${IU}/services/data/v59.0/query?q=${encodeURIComponent(s)}`,{headers:SH}).then(r=>r.json());return r.records||[]};

  // 1) gom touchpoint lead_created SF chưa có sf_name
  const rows:{id:string;lead_id:string;occurred_at:string;payload:any}[]=[];
  let from=0;
  while(from<60000){
    const {data}=await admin.from("fact_touchpoint").select("id,lead_id,occurred_at,payload").eq("source","salesforce").eq("event_type","lead_created").range(from,from+999);
    if(!data?.length)break;
    for(const r of data){const p:any=r.payload||{};if(!p.sf_name&&(p.sf_lead_id||p.sf_contact_id))rows.push(r as any);}
    if(data.length<1000)break;from+=1000;
  }
  console.log(`Touchpoint cần điền tên SF: ${rows.length}`);

  // 2) tra tên theo Id trên SF
  const nameById=new Map<string,string>();
  const ids={lead:[...new Set(rows.map(r=>r.payload.sf_lead_id).filter(Boolean))],contact:[...new Set(rows.map(r=>r.payload.sf_contact_id).filter(Boolean))]};
  for(const [obj,list] of [["Lead",ids.lead],["Contact",ids.contact]] as [string,string[]][]){
    for(let i=0;i<list.length;i+=200){
      const inList=list.slice(i,i+200).map(x=>`'${x}'`).join(",");if(!inList)continue;
      for(const r of await sfq(`SELECT Id,Name FROM ${obj} WHERE Id IN (${inList})`))nameById.set(r.Id,r.Name||"");
    }
  }
  console.log(`Tra được tên: ${nameById.size}`);

  // 3) cập nhật payload
  let up=0;const byLeadTime=new Map<string,string>(); // `${lead_id}|${ms}` → sf_name
  for(const r of rows){
    const nm=nameById.get(r.payload.sf_lead_id)||nameById.get(r.payload.sf_contact_id);
    if(!nm)continue;
    const {error}=await admin.from("fact_touchpoint").update({payload:{...r.payload,sf_name:nm}}).eq("id",r.id);
    if(!error){up++;byLeadTime.set(`${r.lead_id}|${new Date(r.occurred_at).getTime()}`,nm)}
  }
  console.log(`Đã cập nhật payload: ${up}`);

  // 4) map full_name (tên SMAX) để khớp dòng Lark
  const nameByLead=new Map<string,string>();
  const leadIds=[...new Set(rows.map(r=>r.lead_id))];
  for(let i=0;i<leadIds.length;i+=200){
    const {data}=await admin.from("dim_lead").select("lead_id,full_name").in("lead_id",leadIds.slice(i,i+200));
    for(const l of (data||[]))nameByLead.set(l.lead_id,l.full_name||"");
  }
  const keyToName=new Map<string,string>(); // `${ms}|${tênSMAX}` → sf_name
  for(const [k,nm] of byLeadTime){const [lid,ms]=k.split("|");keyToName.set(`${ms}|${nameByLead.get(lid)||""}`,nm)}

  // 5) ghi cột "Tên SF" trên Lark
  const a=await fetch(`${U}/auth/v3/tenant_access_token/internal`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:ID,app_secret:SEC})}).then(r=>r.json());
  const H={Authorization:`Bearer ${a.tenant_access_token}`,"Content-Type":"application/json"};
  const upd:any[]=[];let pt:string|undefined;
  while(true){
    const url=new URL(`${U}/bitable/v1/apps/${APP}/tables/tblKA4jNKmDCRFRB/records`);url.searchParams.set("page_size","500");
    url.searchParams.set("field_names",JSON.stringify(["Time","Event","Lead Name","Tên SF"]));
    if(pt)url.searchParams.set("page_token",pt);
    const d=await fetch(url.toString(),{headers:H}).then(r=>r.json());
    if(d.code!==0){console.log("đọc Lark lỗi",d.code,d.msg);break}
    for(const r of (d.data?.items||[])){
      const f=r.fields||{};
      if(txt(f["Event"])!=="lead_created")continue;
      if(txt(f["Tên SF"]).trim())continue;
      const nm=keyToName.get(`${typeof f["Time"]==="number"?f["Time"]:0}|${txt(f["Lead Name"])}`);
      if(nm)upd.push({record_id:r.record_id,fields:{"Tên SF":nm}});
    }
    if(!d.data?.has_more)break;pt=d.data.page_token;
  }
  let w=0;
  for(let i=0;i<upd.length;i+=400){
    const rr=await fetch(`${U}/bitable/v1/apps/${APP}/tables/tblKA4jNKmDCRFRB/records/batch_update`,{method:"POST",headers:H,body:JSON.stringify({records:upd.slice(i,i+400)})}).then(r=>r.json());
    if(rr.code===0)w+=upd.slice(i,i+400).length;else console.log("ghi lỗi",rr.code,rr.msg);
  }
  console.log(`Lark: ghi "Tên SF" cho ${w} dòng`);
  process.exit(0);
}
main();
