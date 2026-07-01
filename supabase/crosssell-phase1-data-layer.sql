-- ============================================================
-- Cross-sell Engine Phase 1: Customer Lifecycle Data Layer
-- ------------------------------------------------------------
-- Add lifecycle columns to dim_lead + backfill from conversion events.
-- Stages: prospect | onboarding | active_learner | graduated |
--         dormant_customer | churned
-- ============================================================

-- 1. Add columns
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS customer_lifecycle_stage TEXT
  CHECK (customer_lifecycle_stage IN (
    'prospect', 'onboarding', 'active_learner', 'graduated',
    'dormant_customer', 'churned'
  ));
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS first_purchase_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS last_purchase_at TIMESTAMPTZ;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS total_purchases INT DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS lifetime_value NUMERIC DEFAULT 0;
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS courses_purchased TEXT[];
ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS months_since_last_purchase INT;

CREATE INDEX IF NOT EXISTS idx_lead_lifecycle ON dim_lead(customer_lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_lead_last_purchase ON dim_lead(last_purchase_at DESC);

-- 2. Function: extract course code from Opp title
--    Example: "🎓 Đã đăng ký: Nguyễn Thị Cát Linh-FA - F3 - ONL - 2026"
--    → "FA-F3" (course category-batch)
CREATE OR REPLACE FUNCTION extract_course_code(opp_title TEXT) RETURNS TEXT AS $$
DECLARE
  match_result TEXT;
BEGIN
  -- Match pattern: "-XX - YY" where XX is course code (BI, FA, K, F, AGENTIC, etc.)
  match_result := substring(opp_title FROM '- ([A-Z]+ - [A-Z0-9]+)');
  IF match_result IS NULL THEN
    match_result := substring(opp_title FROM '([A-Z]+-[A-Z0-9]+)');
  END IF;
  RETURN COALESCE(match_result, 'UNKNOWN');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Backfill purchase aggregates + lifecycle stage
CREATE OR REPLACE FUNCTION recompute_customer_lifecycle() RETURNS INT AS $$
DECLARE
  updated_count INT;
BEGIN
  WITH purchases AS (
    SELECT
      lead_id,
      COUNT(*) AS n_purchases,
      MIN(occurred_at) AS first_at,
      MAX(occurred_at) AS last_at,
      SUM(COALESCE((payload->>'amount')::numeric, 0)) AS ltv,
      array_agg(DISTINCT extract_course_code(title)) AS courses
    FROM fact_touchpoint
    WHERE event_type = 'conversion' AND source = 'salesforce'
    GROUP BY lead_id
  ),
  scored AS (
    SELECT
      p.*,
      EXTRACT(EPOCH FROM (NOW() - p.last_at)) / (86400 * 30.44) AS months_ago,
      CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - p.last_at)) / (86400 * 30.44) < 3 THEN 'onboarding'
        WHEN EXTRACT(EPOCH FROM (NOW() - p.last_at)) / (86400 * 30.44) < 6 THEN 'active_learner'
        WHEN EXTRACT(EPOCH FROM (NOW() - p.last_at)) / (86400 * 30.44) < 12 THEN 'graduated'
        WHEN EXTRACT(EPOCH FROM (NOW() - p.last_at)) / (86400 * 30.44) < 24 THEN 'dormant_customer'
        ELSE 'churned'
      END AS stage
    FROM purchases p
  )
  UPDATE dim_lead d SET
    customer_lifecycle_stage = s.stage,
    first_purchase_at = s.first_at,
    last_purchase_at = s.last_at,
    total_purchases = s.n_purchases,
    lifetime_value = s.ltv,
    courses_purchased = s.courses,
    months_since_last_purchase = FLOOR(s.months_ago)::INT
  FROM scored s
  WHERE d.lead_id = s.lead_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  -- Set 'prospect' for leads without conversion
  UPDATE dim_lead SET customer_lifecycle_stage = 'prospect'
  WHERE customer_lifecycle_stage IS NULL;

  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION extract_course_code(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_customer_lifecycle() TO anon, authenticated;

-- 4. Run backfill
SELECT recompute_customer_lifecycle() AS customers_backfilled;

-- 5. Report distribution
SELECT customer_lifecycle_stage, COUNT(*) AS count,
       SUM(lifetime_value)::numeric(20,0) AS total_ltv_vnd,
       AVG(total_purchases)::numeric(10,2) AS avg_purchases,
       AVG(months_since_last_purchase)::numeric(10,1) AS avg_months_ago
FROM dim_lead
GROUP BY customer_lifecycle_stage
ORDER BY
  CASE customer_lifecycle_stage
    WHEN 'onboarding' THEN 1
    WHEN 'active_learner' THEN 2
    WHEN 'graduated' THEN 3
    WHEN 'dormant_customer' THEN 4
    WHEN 'churned' THEN 5
    WHEN 'prospect' THEN 6
    ELSE 7
  END;

SELECT '✅ Phase 1 done — lifecycle stages backfilled' AS status;
