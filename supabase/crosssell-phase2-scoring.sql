-- ============================================================
-- Cross-sell Engine Phase 2: Scoring Function
-- ------------------------------------------------------------
-- Score customers in graduated + dormant stages only.
-- Signals specific to cross-sell (not new-lead conversion).
-- Threshold READY >= 60 pts.
-- ============================================================

-- 1. Table for cross-sell scores (parallel to fact_lead_score)
CREATE TABLE IF NOT EXISTS fact_crosssell_score (
  lead_id UUID REFERENCES dim_lead(lead_id) ON DELETE CASCADE,
  scored_at DATE NOT NULL,
  cross_score INT DEFAULT 0,
  cross_reasons JSONB DEFAULT '[]'::jsonb,
  suggested_next_course TEXT,
  PRIMARY KEY (lead_id, scored_at)
);
CREATE INDEX IF NOT EXISTS idx_crosssell_score_desc ON fact_crosssell_score(scored_at, cross_score DESC);

-- 2. Function to suggest next course based on purchase history
--    MDA course sequence heuristic:
--    - BI → FA → AGENTIC AI
--    - Excel/Basic → BI
--    - FA → AGENTIC AI or Advanced Analytics
--    - Any completed → new courses (VIBE, etc.)
CREATE OR REPLACE FUNCTION suggest_next_course(purchased TEXT[]) RETURNS TEXT AS $$
DECLARE
  courses TEXT := array_to_string(purchased, ',');
BEGIN
  -- If has AGENTIC → suggest VIBE / advanced
  IF courses ILIKE '%AGENTIC%' THEN
    RETURN 'VIBE MARKETING / Enterprise Team Package';
  -- If has FA (Financial Analytics) → suggest AGENTIC AI
  ELSIF courses ILIKE '%FA%' THEN
    RETURN 'AGENTIC AI Analytics';
  -- If has BI (Business Intelligence) → suggest FA
  ELSIF courses ILIKE '%BI%' THEN
    RETURN 'FA - Financial Analytics';
  -- If has Excel/Basic → suggest BI
  ELSIF courses ILIKE '%EXCEL%' OR courses ILIKE '%BASIC%' THEN
    RETURN 'BI - Business Intelligence';
  ELSE
    RETURN 'BI - Business Intelligence (introductory path)';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Cross-sell scoring function
CREATE OR REPLACE FUNCTION recompute_crosssell_scores() RETURNS INT AS $$
DECLARE
  scored_count INT;
BEGIN
  -- Delete today's rows first (idempotent)
  DELETE FROM fact_crosssell_score WHERE scored_at = CURRENT_DATE;

  WITH signals AS (
    SELECT
      l.lead_id AS lid,
      l.customer_lifecycle_stage AS stage,
      l.lifetime_value AS ltv,
      l.total_purchases AS purchases,
      l.months_since_last_purchase AS months_ago,
      l.courses_purchased AS courses,
      -- Recency of engagement signals
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_chat_at)) / 86400, 9999) AS chat_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_at)) / 86400, 9999) AS email_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_click_at)) / 86400, 9999) AS click_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_form_submit_at)) / 86400, 9999) AS form_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_login_at)) / 86400, 9999) AS login_days,
      l.chat_count AS chat_total,
      l.form_submit_count AS forms_total,
      l.email_click_count AS click_total,
      l.email_open_count AS opens,
      -- Enterprise heuristic: email domain not gmail/yahoo/hotmail
      (l.email IS NOT NULL AND l.email NOT LIKE '%@gmail.%'
       AND l.email NOT LIKE '%@yahoo.%' AND l.email NOT LIKE '%@hotmail.%'
       AND l.email NOT LIKE '%@outlook.%' AND l.email NOT LIKE '%@icloud.%') AS is_enterprise
    FROM dim_lead l
    WHERE l.customer_lifecycle_stage IN ('graduated', 'dormant_customer')
  ),
  computed AS (
    SELECT
      s.*,
      40 +
      -- HIGH INTENT: Form submit for new course
      (CASE
        WHEN s.forms_total > 0 AND s.form_days <= 3 THEN 40
        WHEN s.forms_total > 0 AND s.form_days <= 7 THEN 30
        WHEN s.forms_total > 0 AND s.form_days <= 14 THEN 20
        WHEN s.forms_total > 0 AND s.form_days <= 30 THEN 10
        ELSE 0
      END) +
      -- HIGH INTENT: Web login (viewing course pages)
      (CASE
        WHEN s.login_days <= 3 THEN 35
        WHEN s.login_days <= 7 THEN 25
        WHEN s.login_days <= 14 THEN 15
        WHEN s.login_days <= 30 THEN 5
        ELSE 0
      END) +
      -- HIGH INTENT: Chat inbound (asking about courses)
      (CASE
        WHEN s.chat_total > 0 AND s.chat_days <= 7 THEN 30
        WHEN s.chat_total > 0 AND s.chat_days <= 14 THEN 20
        WHEN s.chat_total > 0 AND s.chat_days <= 30 THEN 10
        ELSE 0
      END) +
      -- HIGH INTENT: Email click
      (CASE
        WHEN s.click_total > 0 AND s.click_days <= 7 THEN 30
        WHEN s.click_total > 0 AND s.click_days <= 14 THEN 20
        WHEN s.click_total > 0 AND s.click_days <= 30 THEN 10
        ELSE 0
      END) +
      -- MEDIUM: Email open recent
      (CASE
        WHEN s.email_days <= 7 THEN 15
        WHEN s.email_days <= 14 THEN 10
        WHEN s.email_days <= 30 THEN 5
        ELSE 0
      END) +
      -- Timing bonus: graduated 6-12m = prime cross-sell window
      (CASE WHEN s.stage = 'graduated' AND s.months_ago BETWEEN 6 AND 12 THEN 10 ELSE 0 END) +
      -- LTV signal
      (CASE
        WHEN s.ltv >= 30000000 THEN 15  -- >30M
        WHEN s.ltv >= 15000000 THEN 8   -- >15M
        ELSE 0
      END) +
      -- Multi-purchase indicator
      (CASE WHEN s.purchases >= 2 THEN 10 ELSE 0 END) +
      -- Enterprise account
      (CASE WHEN s.is_enterprise THEN 10 ELSE 0 END) +
      -- Silence penalty for dormant with no recent activity
      (CASE
        WHEN s.stage = 'dormant_customer'
             AND LEAST(s.form_days, s.login_days, s.chat_days, s.email_days) > 30 THEN -15
        ELSE 0
      END) AS raw_score
    FROM signals s
  ),
  clamped AS (
    SELECT c.lid, c.stage, c.courses,
      GREATEST(0, LEAST(100, c.raw_score))::INT AS score,
      (
        SELECT jsonb_agg(reason ORDER BY (reason->>'points')::int DESC)
        FROM (
          SELECT jsonb_build_object('sign','+','label','🔥 Submit form khoá mới 3d','points',40) AS reason
            WHERE c.forms_total > 0 AND c.form_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌡 Submit form khoá mới 7d','points',30)
            WHERE c.forms_total > 0 AND c.form_days > 3 AND c.form_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','☀ Submit form khoá mới 14d','points',20)
            WHERE c.forms_total > 0 AND c.form_days > 7 AND c.form_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌤 Submit form khoá mới 30d','points',10)
            WHERE c.forms_total > 0 AND c.form_days > 14 AND c.form_days <= 30
          UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Login viewing course pages 3d','points',35)
            WHERE c.login_days <= 3
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌡 Login website 7d','points',25)
            WHERE c.login_days > 3 AND c.login_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','☀ Login website 14d','points',15)
            WHERE c.login_days > 7 AND c.login_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','🌤 Login website 30d','points',5)
            WHERE c.login_days > 14 AND c.login_days <= 30
          UNION ALL SELECT jsonb_build_object('sign','+','label','💬 Lead chat asking 7d','points',30)
            WHERE c.chat_total > 0 AND c.chat_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','💬 Lead chat asking 14d','points',20)
            WHERE c.chat_total > 0 AND c.chat_days > 7 AND c.chat_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','💬 Lead chat asking 30d','points',10)
            WHERE c.chat_total > 0 AND c.chat_days > 14 AND c.chat_days <= 30
          UNION ALL SELECT jsonb_build_object('sign','+','label','🖱 Click email 7d','points',30)
            WHERE c.click_total > 0 AND c.click_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','🖱 Click email 14d','points',20)
            WHERE c.click_total > 0 AND c.click_days > 7 AND c.click_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','📧 Email open recent 7d','points',15)
            WHERE c.email_days <= 7
          UNION ALL SELECT jsonb_build_object('sign','+','label','📧 Email open 14d','points',10)
            WHERE c.email_days > 7 AND c.email_days <= 14
          UNION ALL SELECT jsonb_build_object('sign','+','label','🎓 Graduated prime timing 6-12m','points',10)
            WHERE c.stage = 'graduated' AND c.months_ago BETWEEN 6 AND 12
          UNION ALL SELECT jsonb_build_object('sign','+','label','💎 High LTV > 30M','points',15)
            WHERE c.ltv >= 30000000
          UNION ALL SELECT jsonb_build_object('sign','+','label','💰 LTV > 15M','points',8)
            WHERE c.ltv >= 15000000 AND c.ltv < 30000000
          UNION ALL SELECT jsonb_build_object('sign','+','label','🔁 Multi-purchase customer','points',10)
            WHERE c.purchases >= 2
          UNION ALL SELECT jsonb_build_object('sign','+','label','🏢 Enterprise account','points',10)
            WHERE c.is_enterprise
          UNION ALL SELECT jsonb_build_object('sign','-','label','😴 Dormant no activity 30d+','points',15)
            WHERE c.stage = 'dormant_customer'
              AND LEAST(c.form_days, c.login_days, c.chat_days, c.email_days) > 30
        ) reasons_subq
      ) AS reasons_json
    FROM computed c
  )
  INSERT INTO fact_crosssell_score (lead_id, scored_at, cross_score, cross_reasons, suggested_next_course)
  SELECT cl.lid, CURRENT_DATE, cl.score,
         COALESCE(cl.reasons_json, '[]'::jsonb),
         suggest_next_course(cl.courses)
  FROM clamped cl;

  GET DIAGNOSTICS scored_count = ROW_COUNT;
  RETURN scored_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION suggest_next_course(TEXT[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION recompute_crosssell_scores() TO anon, authenticated;

-- 4. Run scoring
SELECT recompute_crosssell_scores() AS scored;

-- 5. Distribution report
SELECT
  CASE
    WHEN cross_score >= 60 THEN '💎 READY (60+)'
    WHEN cross_score >= 40 THEN '☀️ NURTURE (40-59)'
    ELSE '❄️ COLD (<40)'
  END AS tier,
  COUNT(*) AS count,
  MIN(cross_score) AS min,
  MAX(cross_score) AS max
FROM fact_crosssell_score
WHERE scored_at = CURRENT_DATE
GROUP BY 1 ORDER BY min DESC;

SELECT '✅ Phase 2 done — cross-sell scores computed' AS status;
