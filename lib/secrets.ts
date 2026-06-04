import { getAnalyticsClient } from "@/lib/supabase/analytics";

/**
 * Workspace-shared secret storage (e.g., Anthropic API key).
 *
 * Stored in `workspace_secret` table with service-role access only.
 * Client-side cannot read raw values via RLS — only via authenticated API
 * endpoint which returns redacted form.
 *
 * Priority order when fetching for use:
 *   1. workspace_secret table (set via UI)
 *   2. process.env (fallback for dev/Vercel env)
 */

export async function getSecret(keyName: string): Promise<string | null> {
  try {
    const supabase = getAnalyticsClient();
    const { data, error } = await supabase
      .from("workspace_secret")
      .select("value")
      .eq("key_name", keyName)
      .maybeSingle();
    if (error) {
      console.warn(`[secrets] getSecret ${keyName} error: ${error.message}`);
      return null;
    }
    return (data?.value as string) ?? null;
  } catch (e) {
    console.warn(`[secrets] getSecret ${keyName} threw: ${(e as Error).message}`);
    return null;
  }
}

export async function setSecret(
  keyName: string,
  value: string,
  updatedByEmail?: string
): Promise<void> {
  const supabase = getAnalyticsClient();
  const last4 = value.slice(-4);
  const { error } = await supabase
    .from("workspace_secret")
    .upsert(
      {
        key_name: keyName,
        value,
        display_hint: `...${last4}`,
        updated_at: new Date().toISOString(),
        updated_by_email: updatedByEmail ?? null,
      },
      { onConflict: "key_name" }
    );
  if (error) throw new Error(`setSecret ${keyName}: ${error.message}`);
}

export async function clearSecret(keyName: string): Promise<void> {
  const supabase = getAnalyticsClient();
  await supabase.from("workspace_secret").delete().eq("key_name", keyName);
}

/**
 * Safe metadata about a secret WITHOUT exposing value — for UI display.
 */
export async function getSecretMetadata(keyName: string): Promise<{
  present: boolean;
  display_hint: string | null;
  updated_at: string | null;
  updated_by_email: string | null;
}> {
  try {
    const supabase = getAnalyticsClient();
    const { data, error } = await supabase
      .from("workspace_secret")
      .select("display_hint, updated_at, updated_by_email")
      .eq("key_name", keyName)
      .maybeSingle();
    if (error || !data) {
      return { present: false, display_hint: null, updated_at: null, updated_by_email: null };
    }
    return {
      present: true,
      display_hint: data.display_hint ?? null,
      updated_at: data.updated_at ?? null,
      updated_by_email: data.updated_by_email ?? null,
    };
  } catch {
    return { present: false, display_hint: null, updated_at: null, updated_by_email: null };
  }
}

/**
 * Get Anthropic API key — priority: workspace_secret → env var.
 */
export async function getAnthropicKey(): Promise<string | null> {
  const dbKey = await getSecret("anthropic_api_key");
  if (dbKey && dbKey.trim()) return dbKey.trim();
  const envKey = process.env.ANTHROPIC_API_KEY;
  return envKey ?? null;
}

export const SECRET_KEYS = {
  ANTHROPIC: "anthropic_api_key",
} as const;
