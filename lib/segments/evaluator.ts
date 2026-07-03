import { admin } from "@/etl/lib/supabase-admin";
import type { FilterField, FilterGroup, FilterRule } from "./types";

/**
 * Evaluate a segment filter against the current leads DB.
 * Returns matching lead_ids (paginated to bypass Supabase 1000-row cap).
 *
 * Strategy: load ALL scored leads with a superset of columns, evaluate the
 * filter in JS. Simple + reliable for MDA scale (~30k leads). Optimize later
 * if we hit performance issues.
 */

const REQUIRED_COLUMNS = [
  "lead_id",
  "source",
  "stage",
  "sf_rating",
  "sf_product",
  "sf_status",
  "chat_count",
  "chat_staff_count",
  "email_open_count",
  "email_click_count",
  "email_reply_count",
  "form_submit_count",
  "login_count",
  "conversion_count",
  "last_chat_at",
  "last_email_at",
  "last_form_submit_at",
  "last_engagement_at",
  "assignee",
  "company",
];

type LeadRow = Record<string, unknown> & { lead_id: string };

function daysAgo(ts: unknown): number {
  if (!ts || typeof ts !== "string") return 9999;
  const ms = new Date(ts).getTime();
  if (!ms || isNaN(ms)) return 9999;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

/** Extract the value for a filter field from a lead row + its score. */
function getFieldValue(field: FilterField, row: LeadRow, score: number): unknown {
  switch (field) {
    case "score":              return score;
    case "chat_days":          return daysAgo(row.last_chat_at);
    case "email_days":         return daysAgo(row.last_email_at);
    case "form_days":          return daysAgo(row.last_form_submit_at);
    case "silent_days":        return daysAgo(row.last_engagement_at);
    default:                   return row[field];
  }
}

function evalRule(rule: FilterRule, row: LeadRow, score: number): boolean {
  const actual = getFieldValue(rule.field, row, score);
  const expected = rule.value;

  switch (rule.op) {
    case "eq":  return String(actual ?? "") === String(expected ?? "");
    case "neq": return String(actual ?? "") !== String(expected ?? "");
    case "gt":  return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":  return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "contains":     return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "not_contains": return !String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "is_null":  return actual === null || actual === undefined || actual === "";
    case "not_null": return actual !== null && actual !== undefined && actual !== "";
    default: return false;
  }
}

function evalGroup(group: FilterGroup, row: LeadRow, score: number): boolean {
  if (!group.rules?.length) return true;
  const results = group.rules.map((r) =>
    "logic" in r ? evalGroup(r as FilterGroup, row, score) : evalRule(r as FilterRule, row, score)
  );
  return group.logic === "OR" ? results.some(Boolean) : results.every(Boolean);
}

/** Load latest scored_at, all scores + all leads once, then filter in JS. */
export async function evaluateSegment(filters: FilterGroup): Promise<string[]> {
  // 1. Latest score date
  const { data: latest } = await admin
    .from("fact_lead_score")
    .select("scored_at")
    .order("scored_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const scoredAt = latest?.scored_at ?? new Date().toISOString().slice(0, 10);

  // 2. Load all scores (paginated)
  const scoreMap = new Map<string, number>();
  let sFrom = 0;
  while (sFrom < 50000) {
    const { data: page } = await admin
      .from("fact_lead_score")
      .select("lead_id, hot_score")
      .eq("scored_at", scoredAt)
      .range(sFrom, sFrom + 999);
    if (!page?.length) break;
    for (const r of page) scoreMap.set(r.lead_id, r.hot_score ?? 0);
    if (page.length < 1000) break;
    sFrom += 1000;
  }

  // 3. Load all leads (paginated)
  const matches: string[] = [];
  let lFrom = 0;
  while (lFrom < 100000) {
    const { data: page } = await admin
      .from("dim_lead")
      .select(REQUIRED_COLUMNS.join(","))
      .range(lFrom, lFrom + 999);
    if (!page?.length) break;
    for (const row of page as unknown as LeadRow[]) {
      const score = scoreMap.get(row.lead_id) ?? 0;
      if (evalGroup(filters, row, score)) matches.push(row.lead_id);
    }
    if (page.length < 1000) break;
    lFrom += 1000;
  }
  return matches;
}
