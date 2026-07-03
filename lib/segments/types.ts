/**
 * Filter DSL for Segment Builder.
 * Compile to Supabase query in evaluator.ts
 */

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "is_null"
  | "not_null";

export type FilterField =
  | "score"
  | "source"
  | "stage"
  | "sf_rating"
  | "sf_product"
  | "sf_status"
  | "chat_count"
  | "chat_staff_count"
  | "email_open_count"
  | "email_click_count"
  | "email_reply_count"
  | "form_submit_count"
  | "login_count"
  | "conversion_count"
  | "chat_days"
  | "email_days"
  | "form_days"
  | "silent_days"
  | "assignee"
  | "company";

export type FilterRule = {
  field: FilterField;
  op: FilterOp;
  value?: string | number | boolean | null;
};

export type FilterGroup = {
  logic: "AND" | "OR";
  rules: (FilterRule | FilterGroup)[];
};

export type Segment = {
  segment_id: string;
  name: string;
  description: string | null;
  filters: FilterGroup;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_computed_at: string | null;
  matching_count: number;
};

/** UI meta about each field for the FilterBuilder */
export const FIELD_META: Record<FilterField, {
  label: string;
  type: "number" | "string" | "enum";
  enumValues?: string[];
  category: "Score" | "Source" | "SF" | "Activity" | "Recency" | "Owner";
}> = {
  score:              { label: "Score",              type: "number", category: "Score" },
  source:             { label: "Nguồn",              type: "enum", enumValues: ["salesforce","smax","instantly","web"], category: "Source" },
  stage:              { label: "Stage",              type: "enum", enumValues: ["Mới","Đang tư vấn","Đang cân nhắc","Im lặng","Đã chốt"], category: "Source" },
  sf_rating:          { label: "SF Rating",          type: "enum", enumValues: ["Hot","Warm","Cold"], category: "SF" },
  sf_product:         { label: "SF Product",         type: "string", category: "SF" },
  sf_status:          { label: "SF Status",          type: "string", category: "SF" },
  chat_count:         { label: "Số lần chat (lead)", type: "number", category: "Activity" },
  chat_staff_count:   { label: "Số lần chat (TVV)",  type: "number", category: "Activity" },
  email_open_count:   { label: "Số email mở",        type: "number", category: "Activity" },
  email_click_count:  { label: "Số email click",     type: "number", category: "Activity" },
  email_reply_count:  { label: "Số email reply",     type: "number", category: "Activity" },
  form_submit_count:  { label: "Số form submit",     type: "number", category: "Activity" },
  login_count:        { label: "Số lần login web",   type: "number", category: "Activity" },
  conversion_count:   { label: "Số conversion",      type: "number", category: "Activity" },
  chat_days:          { label: "Ngày kể từ chat cuối",   type: "number", category: "Recency" },
  email_days:         { label: "Ngày kể từ email cuối",  type: "number", category: "Recency" },
  form_days:          { label: "Ngày kể từ form cuối",   type: "number", category: "Recency" },
  silent_days:        { label: "Ngày im lặng",       type: "number", category: "Recency" },
  assignee:           { label: "TVV phụ trách",      type: "string", category: "Owner" },
  company:            { label: "Company",            type: "string", category: "Owner" },
};

export const OP_META: Record<FilterOp, { label: string; needsValue: boolean; forTypes: ("number"|"string"|"enum")[] }> = {
  eq:            { label: "=",             needsValue: true,  forTypes: ["number","string","enum"] },
  neq:           { label: "≠",             needsValue: true,  forTypes: ["number","string","enum"] },
  gt:            { label: ">",             needsValue: true,  forTypes: ["number"] },
  gte:           { label: "≥",             needsValue: true,  forTypes: ["number"] },
  lt:            { label: "<",             needsValue: true,  forTypes: ["number"] },
  lte:           { label: "≤",             needsValue: true,  forTypes: ["number"] },
  contains:      { label: "chứa",          needsValue: true,  forTypes: ["string"] },
  not_contains:  { label: "không chứa",    needsValue: true,  forTypes: ["string"] },
  is_null:       { label: "trống",         needsValue: false, forTypes: ["number","string","enum"] },
  not_null:      { label: "có giá trị",    needsValue: false, forTypes: ["number","string","enum"] },
};
