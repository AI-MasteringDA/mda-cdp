/**
 * Thông tin kết nối Salesforce — CHỈ ĐỌC, che bớt khoá bí mật.
 *
 * Khác SMAX: Salesforce dùng OAuth 2.0 client_credentials của một Connected App,
 * KHÔNG PHẢI token phiên nên KHÔNG HẾT HẠN. Chỉ hỏng khi ai đó xoay lại secret
 * hoặc vô hiệu hoá Connected App bên Salesforce.
 *
 * Chạy: npx tsx etl/debug/check-sf-connection.ts
 */
import { config } from "dotenv"; import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
const INST=process.env.SALESFORCE_INSTANCE_URL!,CID=process.env.SALESFORCE_CLIENT_ID!,
      CSEC=process.env.SALESFORCE_CLIENT_SECRET!,V=process.env.SALESFORCE_API_VERSION||"v59.0";
const che=(s?:string)=>!s?"(TRỐNG)":`${s.slice(0,8)}…${s.slice(-4)}  (${s.length} ký tự)`;
(async()=>{
  console.log("Instance URL   :",INST);
  console.log("API version    :",V);
  console.log("Client ID      :",che(CID));
  console.log("Client Secret  :",che(CSEC));
  console.log("Kiểu xác thực  : OAuth 2.0 — grant_type=client_credentials");
  const t0=Date.now();
  const tr=await fetch(`${INST}/services/oauth2/token`,{method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"client_credentials",client_id:CID,client_secret:CSEC})}).then(r=>r.json());
  if(!tr.access_token){console.log("\n❌ Lấy token THẤT BẠI:",JSON.stringify(tr));return}
  console.log(`\n✅ Lấy được access token trong ${Date.now()-t0}ms`);
  const H={Authorization:`Bearer ${tr.access_token}`};
  const me=await fetch(tr.id,{headers:H}).then(r=>r.json()).catch(()=>null);
  if(me){
    console.log("Chạy dưới danh nghĩa user:");
    console.log("   tên      :",me.display_name||me.username);
    console.log("   username :",me.username);
    console.log("   user id  :",me.user_id);
    console.log("   org id   :",me.organization_id);
  }
  const lim=await fetch(`${INST}/services/data/${V}/limits`,{headers:H}).then(r=>r.json()).catch(()=>null);
  if(lim?.DailyApiRequests)
    console.log(`\nHạn mức API hôm nay: còn ${lim.DailyApiRequests.Remaining}/${lim.DailyApiRequests.Max} lượt gọi`);
  const q=await fetch(`${INST}/services/data/${V}/query?q=${encodeURIComponent("SELECT COUNT() FROM Lead")}`,{headers:H}).then(r=>r.json());
  console.log("Đọc thử bảng Lead :",q.totalSize!=null?`✅ ${q.totalSize} lead`:"❌ "+JSON.stringify(q).slice(0,120));
})();
