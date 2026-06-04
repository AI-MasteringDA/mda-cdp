import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/^﻿/, "");
const key = process.env.SUPABASE_SECRET_KEY!.trim().replace(/^﻿/, "");

const SQL = `
CREATE TABLE IF NOT EXISTS public.ai_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_cache_key_idx ON public.ai_cache(cache_key);
CREATE INDEX IF NOT EXISTS ai_cache_updated_idx ON public.ai_cache(updated_at DESC);

GRANT ALL ON public.ai_cache TO service_role;
GRANT ALL ON public.ai_cache TO postgres;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
`;

async function main() {
  console.log("📋 Creating ai_cache via REST API...\n");

  // Try Supabase REST query endpoint (allows SQL via service-role)
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: SQL }),
  });

  const body = await res.text();
  console.log(`HTTP ${res.status}: ${body.slice(0, 300)}`);

  if (res.status === 404) {
    console.log("\n⚠️  exec_sql RPC not available. Need manual SQL run.");
    console.log("---");
    console.log("Open: https://supabase.com/dashboard/project/_/sql/new");
    console.log("Paste:\n");
    console.log(SQL);
    console.log("---");
  }
}

main().catch(console.error);
