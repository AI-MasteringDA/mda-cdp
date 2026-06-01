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

export const admin: SupabaseClient = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
