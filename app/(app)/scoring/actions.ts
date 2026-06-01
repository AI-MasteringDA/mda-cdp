"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function toggleScoringRule(ruleId: string, enabled: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("scoring_rule")
    .update({ enabled })
    .eq("id", ruleId);
  if (error) return { error: error.message };
  revalidatePath("/scoring");
  return { success: true };
}

export async function recomputeScores() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recompute_lead_scores");
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/hot-leads");
  revalidatePath("/cold-leads");
  revalidatePath("/leads");
  revalidatePath("/scoring");
  return { success: true, count: data?.length ?? 0 };
}
