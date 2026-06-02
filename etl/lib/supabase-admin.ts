import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL trong .env.local");
if (!secretKey) {
  throw new Error(
    "Thiếu SUPABASE_SECRET_KEY trong .env.local. Lấy từ Supabase Dashboard → Settings → API Keys → Secret keys (default)."
  );
}

const cleanUrl = url.trim().replace(/^﻿/, "");
const cleanKey = secretKey.trim().replace(/^﻿/, "");

export const admin: SupabaseClient = createClient(cleanUrl, cleanKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Account ID for which the ETL writes data. Set in .env.local as ETL_ACCOUNT_ID.
// Fetched from `account` table by owner_email once at boot. Falls back to null →
// inserts will fail RLS. ETL with service_role key bypasses RLS but still needs
// account_id column populated (NOT NULL after backfill).
let _cachedAccountId: string | null = null;

export async function getEtlAccountId(): Promise<string> {
  if (_cachedAccountId) return _cachedAccountId;
  const envAccountId = process.env.ETL_ACCOUNT_ID;
  if (envAccountId) {
    _cachedAccountId = envAccountId;
    return envAccountId;
  }
  const ownerEmail = process.env.ETL_OWNER_EMAIL || "ai@mastering-da.com";
  const { data, error } = await admin
    .from("account")
    .select("id")
    .eq("owner_email", ownerEmail)
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      `Không tìm thấy account cho ${ownerEmail}. ` +
      `Set ETL_ACCOUNT_ID trong .env.local hoặc tạo account trước (chạy backfill-mda-account.sql).`
    );
  }
  _cachedAccountId = data.id;
  return data.id;
}
