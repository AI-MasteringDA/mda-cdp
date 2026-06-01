import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function describe(value: string | undefined) {
  if (!value) return { present: false };
  return {
    present: true,
    length: value.length,
    firstChars: value.slice(0, 12),
    lastChars: value.slice(-6),
    hasTrailingNewline: value.includes("\n") || value.includes("\r"),
    hasLeadingSpace: value !== value.trimStart(),
  };
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;

  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      NEXT_PUBLIC_SUPABASE_URL: describe(url),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: describe(pub),
      SUPABASE_SECRET_KEY: describe(secret),
      INSTANTLY_API_KEY: describe(process.env.INSTANTLY_API_KEY),
      SMAX_API_KEY: describe(process.env.SMAX_API_KEY),
    },
  };

  // Test Supabase connection
  if (url && pub) {
    try {
      const client = createClient(url.trim(), pub.trim());
      const { data, error, count } = await client
        .from("dim_lead")
        .select("*", { count: "exact", head: true });
      result.test_anon = {
        success: !error,
        count,
        error: error?.message,
      };
    } catch (e) {
      result.test_anon = { success: false, error: (e as Error).message };
    }
  }

  if (url && secret) {
    try {
      const client = createClient(url.trim(), secret.trim());
      const { count, error } = await client
        .from("dim_lead")
        .select("*", { count: "exact", head: true });
      result.test_secret = {
        success: !error,
        count,
        error: error?.message,
      };
    } catch (e) {
      result.test_secret = { success: false, error: (e as Error).message };
    }
  }

  return NextResponse.json(result);
}
