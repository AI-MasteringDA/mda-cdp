import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const INSTANCE = process.env.SALESFORCE_INSTANCE_URL!;
const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID!;
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET!;
const API_VERSION = process.env.SALESFORCE_API_VERSION || "v59.0";

console.log("=== INSPECT Salesforce REST API ===");
console.log(`Instance: ${INSTANCE}`);
console.log(`API:      /services/data/${API_VERSION}\n`);

async function getAccessToken(): Promise<{ access_token: string; instance_url: string }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(`${INSTANCE}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function query(token: string, soql: string) {
  const url = `${INSTANCE}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    return { error: await res.text(), status: res.status };
  }
  return res.json();
}

async function main() {
  // 1. Get token
  console.log("📡 Getting access token...");
  let token: string;
  try {
    const r = await getAccessToken();
    token = r.access_token;
    console.log(`✅ Token: ${token.slice(0, 40)}...`);
    console.log(`   Instance: ${r.instance_url}\n`);
  } catch (e) {
    console.error("❌ Token failed:", (e as Error).message);
    return;
  }

  // 2. List objects available
  console.log("📋 Discovering objects...");
  const objects = ["Contact", "Lead", "Opportunity", "Task", "Event", "Account", "User"];
  for (const obj of objects) {
    const r = await query(token, `SELECT COUNT(Id) AS n FROM ${obj}`);
    if ("error" in r) {
      console.log(`  ❌ ${obj.padEnd(15)} ${r.error.slice(0, 80)}`);
    } else {
      const count = (r as { records?: Array<{ n?: number; expr0?: number }> }).records?.[0];
      const n = count?.n ?? count?.expr0 ?? "?";
      console.log(`  ✅ ${obj.padEnd(15)} count: ${n}`);
    }
  }

  // 3. Sample Contact
  console.log("\n📋 Sample Contact (first 1 record):");
  const contactQ = await query(
    token,
    "SELECT Id, Name, Email, Phone, MobilePhone, AccountId, OwnerId, CreatedDate, LastModifiedDate FROM Contact LIMIT 1"
  );
  console.log(JSON.stringify(contactQ, null, 2).slice(0, 1500));

  // 4. Sample Lead
  console.log("\n📋 Sample Lead (first 1 record):");
  const leadQ = await query(
    token,
    "SELECT Id, Name, Email, Phone, Company, Status, LeadSource, OwnerId, CreatedDate FROM Lead LIMIT 1"
  );
  console.log(JSON.stringify(leadQ, null, 2).slice(0, 1500));

  // 5. Sample Opportunity
  console.log("\n📋 Sample Opportunity (first 1 record):");
  const oppQ = await query(
    token,
    "SELECT Id, Name, StageName, Amount, CloseDate, AccountId, OwnerId, CreatedDate FROM Opportunity LIMIT 1"
  );
  console.log(JSON.stringify(oppQ, null, 2).slice(0, 1500));

  // 6. Sample Task (activities/calls)
  console.log("\n📋 Sample Task (first 1 record):");
  const taskQ = await query(
    token,
    "SELECT Id, Subject, WhoId, WhatId, Status, Priority, ActivityDate, CallDurationInSeconds, CreatedDate FROM Task LIMIT 1"
  );
  console.log(JSON.stringify(taskQ, null, 2).slice(0, 1500));

  // 7. Opportunity stages
  console.log("\n📋 Distinct Opportunity StageNames:");
  const stagesQ = await query(token, "SELECT StageName, COUNT(Id) n FROM Opportunity GROUP BY StageName");
  console.log(JSON.stringify(stagesQ, null, 2).slice(0, 1500));
}

main().catch(console.error);
