import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const U="https://open.larksuite.com/open-apis";
const ID=process.env.LARK_APP_ID!,SEC=process.env.LARK_APP_SECRET!,APP=process.env.LARK_BASE_APP_TOKEN!;
const INST=process.env.SALESFORCE_INSTANCE_URL!,CID=process.env.SALESFORCE_CLIENT_ID!,CSEC=process.env.SALESFORCE_CLIENT_SECRET!;
const V=process.env.SALESFORCE_API_VERSION||"v59.0";
const gl=(v:any):string[]=>Array.isArray(v)?v.map((x:any)=>typeof x==="object"&&x?(x.text??x.name??""):String(x)).filter(Boolean):[];
const gs=(v:any):string=>Array.isArray(v)?v.map((x:any)=>x?.text??"").join(""):(v==null?"":String(v));
const nz=(s:string)=>s.toLowerCase().replace(/[\s_-]+/g,"");
const nk=(s:string)=>String(s??"").replace(/[_\s-]*\+?\d[\d\s.]{7,}$/,"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/đ/g,"d").replace(/[^a-z0-9]+/g," ").trim();
const ph=(s:string)=>{const d=String(s??"").replace(/\D/g,"");return d.length>=9?d.slice(-9):""};
(async()=>{
  // ── SMAX (Lark)
  const tk=(await fetch(`${U}/auth/v3/tenant_access_token/internal`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:ID,app_secret:SEC})}).then(r=>r.json())).tenant_access_token;
  const H={Authorization:`Bearer ${tk}`,"Content-Type":"application/json"};
  const t=await fetch(`${U}/bitable/v1/apps/${APP}/tables?page_size=100`,{headers:H}).then(r=>r.json());
  const id=t.data.items.find((x:any)=>x.name==="SMAX_Database").table_id;
  type L={rid:string;name:string;phone:string;email:string;cls:string;k62:boolean;kh62:boolean;hotMs:number|null};
  const all:L[]=[]; let pt:string|undefined;
  const FN=["Lead Name","Phone","Email","Tag SMAX","K62 lúc","KH62 lúc","Hot Lead lúc"];
  while(true){
    const u=new URL(`${U}/bitable/v1/apps/${APP}/tables/${id}/records`);
    u.searchParams.set("page_size","500"); u.searchParams.set("field_names",JSON.stringify(FN));
    if(pt)u.searchParams.set("page_token",pt);
    const d=await fetch(u.toString(),{headers:H}).then(r=>r.json());
    if(d.code!==0)throw new Error(d.msg);
    for(const r of (d.data?.items??[])){
      const f=r.fields??{};
      if(typeof f["K62 lúc"]!=="number"&&typeof f["KH62 lúc"]!=="number")continue;
      const tags=gl(f["Tag SMAX"]);
      if(tags.some(x=>nz(x)==="spam"||nz(x).includes("block")))continue;
      const CLS:any={prospect:"Prospect",coldlead:"Cold",warmlead:"Warm",hotlead:"Hot"};
      let cls="(chưa tag)"; for(const x of tags){const c=CLS[nz(x)];if(c){cls=c;break}}
      all.push({rid:r.record_id,name:gs(f["Lead Name"]),phone:gs(f["Phone"]),email:gs(f["Email"]),cls,
        k62:typeof f["K62 lúc"]==="number",kh62:typeof f["KH62 lúc"]==="number",
        hotMs:typeof f["Hot Lead lúc"]==="number"?f["Hot Lead lúc"]:null});
    }
    if(!d.data?.has_more)break; pt=d.data.page_token;
  }
  const hot=all.filter(x=>x.cls==="Hot");
  console.log(`SMAX  K62/KH62: ${all.length} lead · Hot ${hot.length}  (K62 ${all.filter(x=>x.k62).length}, KH62 ${all.filter(x=>x.kh62).length}, cả hai ${all.filter(x=>x.k62&&x.kh62).length})`);

  // ── Salesforce
  const tr=await fetch(`${INST}/services/oauth2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:CID,client_secret:CSEC})}).then(r=>r.json());
  const SH={Authorization:`Bearer ${tr.access_token}`};
  const sf:any[]=[]; let url=`${INST}/services/data/${V}/query?q=${encodeURIComponent(`SELECT Id,Name,Phone,Email,Rating,IsConverted,Product__r.Name FROM Lead WHERE Product__r.Name LIKE '%62%'`)}`;
  while(url){const r=await fetch(url,{headers:SH}).then(r=>r.json());sf.push(...(r.records||[]));url=r.nextRecordsUrl?INST+r.nextRecordsUrl:"";}
  console.log(`SF    Product ~62 : ${sf.length} lead · Hot ${sf.filter(x=>x.Rating==="Hot").length} · Cold ${sf.filter(x=>x.Rating==="Cold").length}`);

  // ── ghép theo SĐT rồi tên
  const sfByPh=new Map<string,any>(),sfByNm=new Map<string,any>();
  for(const s of sf){const p=ph(s.Phone);if(p)sfByPh.set(p,s);const n=nk(s.Name);if(n)sfByNm.set(n,s);}
  let m=0,noSF=0; const missing:L[]=[];
  for(const h of hot){
    const s=sfByPh.get(ph(h.phone))||sfByNm.get(nk(h.name));
    if(s)m++; else {noSF++; missing.push(h);}
  }
  console.log(`\n>>> Trong ${hot.length} Hot của SMAX: ${m} người CÓ trên SF, ${noSF} người KHÔNG có trên SF`);
  console.log(`\n── ${missing.length} Hot (SMAX) chưa thấy trên SF K62 ──`);
  missing.forEach((x,i)=>console.log(` ${String(i+1).padStart(2)}. ${x.name.padEnd(30)} ${x.phone.padEnd(13)} ${x.email}`));

  // chiều ngược lại: SF Hot mà SMAX không tính Hot
  const smaxByPh=new Map<string,L>(),smaxByNm=new Map<string,L>();
  for(const a of all){const p=ph(a.phone);if(p)smaxByPh.set(p,a);const n=nk(a.name);if(n)smaxByNm.set(n,a);}
  console.log(`\n── SF Hot nhưng SMAX KHÔNG phải Hot ──`);
  let c=0;
  for(const s of sf.filter(x=>x.Rating==="Hot")){
    const a=smaxByPh.get(ph(s.Phone))||smaxByNm.get(nk(s.Name));
    if(!a) console.log(` • ${String(s.Name).padEnd(30)} → không có tag K62 trên SMAX${s.IsConverted?" (đã convert)":""}`),c++;
    else if(a.cls!=="Hot") console.log(` • ${String(s.Name).padEnd(30)} → SMAX đang là ${a.cls}${s.IsConverted?" (đã convert)":""}`),c++;
  }
  if(!c)console.log("  (không có)");
})();
