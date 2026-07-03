-- ============================================================================
-- Segment Builder — dynamic lead segments defined by JSON filter rules
-- ============================================================================
-- Users compose filter rules (score, source, chat, form, rating, product, ...)
-- into named segments. Segment members auto-recomputed hourly.
-- Segments can be exported to CSV, pushed to campaigns, or used for automation.
-- ============================================================================

-- 1. Segment definition
CREATE TABLE IF NOT EXISTS dim_segment (
  segment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  filters           JSONB NOT NULL,       -- structured filter rules (see docs)
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_computed_at  TIMESTAMPTZ,
  matching_count    INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dim_segment_name ON dim_segment(name);
CREATE INDEX IF NOT EXISTS idx_dim_segment_created_at ON dim_segment(created_at DESC);

-- 2. Segment membership snapshot
CREATE TABLE IF NOT EXISTS fact_segment_member (
  segment_id  UUID REFERENCES dim_segment(segment_id) ON DELETE CASCADE,
  lead_id     UUID REFERENCES dim_lead(lead_id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (segment_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_fsm_segment ON fact_segment_member(segment_id);
CREATE INDEX IF NOT EXISTS idx_fsm_lead ON fact_segment_member(lead_id);

-- 3. RLS policies
ALTER TABLE dim_segment ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_segment_member ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all on dim_segment" ON dim_segment;
CREATE POLICY "allow all on dim_segment" ON dim_segment FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow all on fact_segment_member" ON fact_segment_member;
CREATE POLICY "allow all on fact_segment_member" ON fact_segment_member FOR ALL USING (true) WITH CHECK (true);

-- 4. Filter DSL example
-- {
--   "logic": "AND",
--   "rules": [
--     { "field": "score",           "op": "gte", "value": 70 },
--     { "field": "source",          "op": "eq",  "value": "smax" },
--     { "field": "sf_rating",       "op": "eq",  "value": "Hot" },
--     { "field": "sf_product",      "op": "contains", "value": "K61" },
--     { "field": "chat_days",       "op": "lte", "value": 7 },
--     { "field": "form_submit_count", "op": "gt", "value": 0 }
--   ]
-- }
--
-- Supported ops: eq | neq | gt | gte | lt | lte | contains | not_contains | is_null | not_null
-- Nested logic: rule.rules[] with logic=AND/OR
