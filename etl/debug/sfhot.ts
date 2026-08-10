import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const ID=process.env.LARK_APP_ID||"",SEC=process.env.LARK_APP_SECRET||"",APP=process.env.LARK_BASE_APP_TOKEN||"";const U="https://open.larksuite.com/open-apis";
const day=(ms:number)=>new Date(ms+7*3600*1000).toISOString().slice(0,10);
const arr=(v:any)=>Array.isArray(v)?v.map((x:any)=>typeof x==="object"&&x?(x.text??x.name??""):String(x)).filter(Boolean):[];
const s1=(v:any)=>Array.isArray(v)?v.map((x:any)=>typeof x==="object"&&x?(x.text??""):x).join(""):(v==null?"":String(v));
async function main(){
  const a=await fetch(`${U}/auth/v3/tenant_access_token/internal`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:ID,app_secret:SEC})}).then(r=>r.json());
  const H={Authorization:`Bearer ${a.tenant_access_token}`};
  const cnt:Record<string,{tot:number,blank:number,names:string[]}>={};let pt="";
  while(true){const u=new URL(`${U}/bitable/v1/apps/${APP}/tables/tblKA4jNKmDCRFRB/records`);u.searchParams.set("page_size","500");
    u.searchParams.set("field_names",JSON.stringify(["Time","Event","Lead Name","Tag SMAX"]));if(pt)u.searchParams.set("page_token",pt);
    const d=await fetch(u.toString(),{headers:H}).then(r=>r.json());
    for(const r of (d.data?.items||[])){const ev=s1(r.fields?.["Event"]);if(ev!=="lead_created")continue;
      const t=r.fields?.["Time"];if(typeof t!=="number")continue;const dd=day(t);if(dd<"2026-08-03")continue;
      cnt[dd]=cnt[dd]||{tot:0,blank:0,names:[]};cnt[dd].tot++;
      if(!arr(r.fields?.["Tag SMAX"]).length){cnt[dd].blank++;cnt[dd].names.push(s1(r.fields?.["Lead Name"]))}}
    if(!d.data?.has_more)break;pt=d.data.page_token;}
  console.log("SF lead_created — tổng / chưa có trên SMAX (được count thêm):");
  for(const dd of Object.keys(cnt).sort())console.log(`  ${dd}: ${cnt[dd].tot} tổng · ${cnt[dd].blank} đếm thêm → ${cnt[dd].names.join(", ")}`);
  process.exit(0);
}
main();
