import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const API_KEY = process.env.INSTANTLY_API_KEY!;
const BASE_URL = process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2";

async function inspect() {
  console.log("=== INSPECT Instantly API V2 ===\n");

  // 1. Lấy 3 email records để xem cấu trúc
  console.log("📧 GET /emails (limit=3)\n");
  const emailsRes = await fetch(`${BASE_URL}/emails?limit=3`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const emailsData = await emailsRes.json();
  console.log("Status:", emailsRes.status);
  console.log("Response keys:", Object.keys(emailsData));
  if (emailsData.items?.length > 0) {
    console.log("\n--- Sample email record (full) ---");
    console.log(JSON.stringify(emailsData.items[0], null, 2));
    console.log("\n--- All field names ---");
    console.log(Object.keys(emailsData.items[0]).join(", "));
  } else {
    console.log("⚠️ Không có email records trả về");
    console.log("Full response:", JSON.stringify(emailsData, null, 2).slice(0, 500));
  }

  // 2. Thử endpoint analytics
  console.log("\n\n📊 GET /campaigns (list campaigns)\n");
  const camp = await fetch(`${BASE_URL}/campaigns?limit=5`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const campData = await camp.json();
  console.log("Status:", camp.status);
  if (campData.items?.length > 0) {
    console.log(`Found ${campData.items.length} campaigns:`);
    for (const c of campData.items) {
      console.log(`  - ${c.name} (id: ${c.id?.slice(0, 8)}...)`);
    }
  }
}

inspect().catch(console.error);
