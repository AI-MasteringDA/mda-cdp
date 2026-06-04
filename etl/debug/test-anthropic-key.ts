import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });
import { admin } from "../lib/supabase-admin";

async function main() {
  // 1) Check what key is stored in workspace_secret
  console.log("📋 Checking workspace_secret for anthropic_api_key:\n");
  const { data: secret, error } = await admin
    .from("workspace_secret")
    .select("display_hint, updated_by_email, updated_at, value")
    .eq("key_name", "anthropic_api_key")
    .maybeSingle();

  if (error) {
    console.error("DB error:", error.message);
    return;
  }

  let keyToTest: string | null = null;
  if (secret) {
    console.log(`   ✓ Key in DB: sk-ant-${secret.display_hint?.replace("...", "")}`);
    console.log(`   Set by:  ${secret.updated_by_email}`);
    console.log(`   At:      ${secret.updated_at}`);
    keyToTest = secret.value;
  } else {
    console.log("   ❌ NO key in workspace_secret table");
    console.log("   Falling back to process.env.ANTHROPIC_API_KEY");
    keyToTest = process.env.ANTHROPIC_API_KEY ?? null;
  }

  if (!keyToTest) {
    console.error("\n❌ No Anthropic key available anywhere.");
    return;
  }

  // 2) Test the key with a simple Claude call
  console.log(`\n🧪 Testing Claude API with key sk-ant-...${keyToTest.slice(-4)}\n`);
  const startTime = Date.now();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": keyToTest,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 100,
        messages: [{ role: "user", content: "Trả về JSON {\"ok\":true}" }],
      }),
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const body = await res.text();
    console.log(`   HTTP ${res.status} in ${elapsed}s`);
    console.log(`   Body: ${body.slice(0, 300)}`);
    if (res.status === 401) {
      console.log("\n❌ KEY INVALID — paste lại key đúng vào UI");
    } else if (res.status === 429) {
      console.log("\n❌ RATE LIMITED — đợi vài phút");
    } else if (res.status === 400 && body.includes("credit")) {
      console.log("\n❌ BALANCE TRỐNG — nạp tiền tại console.anthropic.com");
    } else if (res.ok) {
      console.log("\n✅ KEY VALID + BALANCE OK");
    }
  } catch (e) {
    console.error(`\n❌ Network error: ${(e as Error).message}`);
  }
}

main().catch(console.error);
