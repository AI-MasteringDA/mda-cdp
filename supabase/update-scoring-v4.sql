-- ============================================================
-- Scoring V4 — fix over-stacking cold rules
-- ------------------------------------------------------------
-- Bug V3: tất cả lead nguội = 100 vì rules stack lên:
--   30 (>14d) + 30 (>30d) + 25 (>90d) + 25 (email>14d) + 20 (never_engaged) = 130 → cap 100
-- → mất phân biệt
--
-- V4: dùng MUTUALLY EXCLUSIVE tiers cho silence (1 tier duy nhất fire)
-- + giảm weights để score reflect mức độ nguội thực sự:
--   14-30d:  warm cold   = 40   (đáng cứu, chưa quá muộn)
--   30-90d:  real cold   = 65   (cần re-activate gấp)
--   90-180d: very cold   = 80   (xem xét đóng / batch email)
--   180+d:   dormant     = 95   (gần như chết, nên đóng case)
-- ============================================================

-- 1. Disable V3 rules (im lặng > X stack)
UPDATE scoring_rule SET enabled = false
WHERE signal IN (
  'days_since_last_touchpoint',
  'silent_after_email',
  'silent_after_chat',
  'never_engaged'
);

-- 2. Add tiered mutually-exclusive rules
INSERT INTO scoring_rule (variant, signal, signal_label, operator, threshold, weight, time_window, enabled) VALUES
  ('cold', 'silence_tier_warm',    'Im lặng 14-30 ngày',          '=', 1, 40, '30d',  true),
  ('cold', 'silence_tier_real',    'Im lặng 30-90 ngày',          '=', 1, 65, '90d',  true),
  ('cold', 'silence_tier_very',    'Im lặng 90-180 ngày',         '=', 1, 80, '180d', true),
  ('cold', 'silence_tier_dormant', 'Im lặng > 180 ngày (gần chết)', '=', 1, 95, '180d', true),
  ('cold', 'cold_never_engaged',   'Chưa từng tương tác sau khi tạo', '=', 1, 25, '90d', true)
ON CONFLICT DO NOTHING;

-- 3. Recreate function với tier logic
DROP FUNCTION IF EXISTS recompute_lead_scores();

CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_hot INT, out_cold INT) AS $$
BEGIN
  RETURN QUERY
  WITH
  signals AS (
    SELECT
      l.lead_id AS lid,
      -- HOT signals (giữ nguyên V2/V3)
      COUNT(*) FILTER (WHERE t.event_type = 'chat' AND t.occurred_at > NOW() - INTERVAL '3 days') AS chat_initiated_count,
      COUNT(*) FILTER (WHERE t.event_type = 'chat_staff' AND t.occurred_at > NOW() - INTERVAL '3 days') AS chat_staff_count_3d,
      COUNT(*) FILTER (WHERE t.event_type = 'chat_staff' AND t.occurred_at > NOW() - INTERVAL '90 days') AS chat_staff_total,
      COUNT(*) FILTER (WHERE t.event_type = 'email_sent' AND t.occurred_at > NOW() - INTERVAL '7 days') AS email_sent_recent,
      COUNT(*) FILTER (
        WHERE t.occurred_at > NOW() - INTERVAL '90 days'
        AND t.event_type IN ('chat','chat_staff','email_sent','email_open','email_click','call','meeting','note','form_submit','page_view')
      ) AS total_engagement,
      COUNT(DISTINCT t.source) FILTER (WHERE t.source IN ('smax','salesforce','instantly','web','fanpage')) AS multi_source,

      -- COLD: days_since_last_touchpoint (MAX of any touchpoint)
      -- Nếu chưa có touchpoint nào → 9999 (catch-all rất cũ)
      COALESCE(
        EXTRACT(EPOCH FROM (NOW() - MAX(t.occurred_at))) / 86400,
        9999
      ) AS days_since_last_touchpoint,

      -- Engagement counter (any meaningful interaction)
      COUNT(*) FILTER (
        WHERE t.event_type IN ('chat','chat_staff','email_sent','email_open','email_click','call','meeting','form_submit','page_view')
      ) AS engagement_count,

      EXTRACT(EPOCH FROM (NOW() - COALESCE(l.last_touch_at, l.first_seen_at))) / 86400 AS days_since_last_contact
    FROM dim_lead l
    LEFT JOIN fact_touchpoint t ON t.lead_id = l.lead_id
    WHERE l.stage != 'Đã chốt'
    GROUP BY l.lead_id, l.last_touch_at, l.first_seen_at
  ),
  -- TIER computation: MỖI LEAD CHỈ ROI VÀO 1 TIER duy nhất
  signal_tiers AS (
    SELECT
      s.lid,
      s.chat_initiated_count,
      s.chat_staff_count_3d,
      s.chat_staff_total,
      s.email_sent_recent,
      s.total_engagement,
      s.multi_source,
      s.days_since_last_contact,
      -- Mutually exclusive: chỉ 1 = 1, các tier khác = 0
      CASE WHEN s.days_since_last_touchpoint > 14  AND s.days_since_last_touchpoint <= 30  THEN 1 ELSE 0 END AS silence_tier_warm,
      CASE WHEN s.days_since_last_touchpoint > 30  AND s.days_since_last_touchpoint <= 90  THEN 1 ELSE 0 END AS silence_tier_real,
      CASE WHEN s.days_since_last_touchpoint > 90  AND s.days_since_last_touchpoint <= 180 THEN 1 ELSE 0 END AS silence_tier_very,
      CASE WHEN s.days_since_last_touchpoint > 180 THEN 1 ELSE 0 END AS silence_tier_dormant,
      -- "Chưa từng tương tác" = no engagement events at all
      CASE WHEN s.engagement_count = 0 THEN 1 ELSE 0 END AS cold_never_engaged
    FROM signals s
  ),
  rule_matches AS (
    SELECT
      st.lid, r.variant, r.weight, r.signal_label,
      CASE r.signal
        WHEN 'chat_initiated_count'      THEN st.chat_initiated_count
        WHEN 'chat_staff_count_3d'       THEN st.chat_staff_count_3d
        WHEN 'chat_staff_total'          THEN st.chat_staff_total
        WHEN 'email_sent_recent'         THEN st.email_sent_recent
        WHEN 'total_engagement'          THEN st.total_engagement
        WHEN 'multi_source'              THEN st.multi_source
        WHEN 'days_since_last_contact'   THEN st.days_since_last_contact
        WHEN 'silence_tier_warm'         THEN st.silence_tier_warm
        WHEN 'silence_tier_real'         THEN st.silence_tier_real
        WHEN 'silence_tier_very'         THEN st.silence_tier_very
        WHEN 'silence_tier_dormant'      THEN st.silence_tier_dormant
        WHEN 'cold_never_engaged'        THEN st.cold_never_engaged
        ELSE 0
      END AS signal_value,
      r.operator, r.threshold
    FROM signal_tiers st CROSS JOIN scoring_rule r
    WHERE r.enabled = true
  ),
  matched AS (
    SELECT rm.lid, rm.variant, rm.weight, rm.signal_label
    FROM rule_matches rm
    WHERE
      (rm.operator = '>'  AND rm.signal_value > rm.threshold)  OR
      (rm.operator = '>=' AND rm.signal_value >= rm.threshold) OR
      (rm.operator = '<'  AND rm.signal_value < rm.threshold)  OR
      (rm.operator = '<=' AND rm.signal_value <= rm.threshold) OR
      (rm.operator = '='  AND rm.signal_value = rm.threshold)
  ),
  totals AS (
    SELECT
      m.lid,
      LEAST(100, COALESCE(SUM(CASE WHEN m.variant = 'hot'  THEN m.weight END), 0))::INT AS hot_score,
      LEAST(100, COALESCE(SUM(CASE WHEN m.variant = 'cold' THEN m.weight END), 0))::INT AS cold_score,
      COALESCE(jsonb_agg(m.signal_label) FILTER (WHERE m.variant = 'hot'),  '[]'::jsonb) AS hot_reasons,
      COALESCE(jsonb_agg(m.signal_label) FILTER (WHERE m.variant = 'cold'), '[]'::jsonb) AS cold_reasons
    FROM matched m
    GROUP BY m.lid
  ),
  final_scores AS (
    SELECT
      l.lead_id AS lid,
      COALESCE(t.hot_score, 0) AS hot_score,
      COALESCE(t.cold_score, 0) AS cold_score,
      COALESCE(t.hot_reasons, '[]'::jsonb) AS hot_reasons,
      COALESCE(t.cold_reasons, '[]'::jsonb) AS cold_reasons
    FROM dim_lead l
    LEFT JOIN totals t ON t.lid = l.lead_id
    WHERE l.stage != 'Đã chốt'
  ),
  upserted AS (
    INSERT INTO fact_lead_score (lead_id, scored_at, hot_score, cold_score, hot_reasons, cold_reasons)
    SELECT fs.lid, CURRENT_DATE, fs.hot_score, fs.cold_score, fs.hot_reasons, fs.cold_reasons
    FROM final_scores fs
    ON CONFLICT (lead_id, scored_at) DO UPDATE SET
      hot_score    = EXCLUDED.hot_score,
      cold_score   = EXCLUDED.cold_score,
      hot_reasons  = EXCLUDED.hot_reasons,
      cold_reasons = EXCLUDED.cold_reasons
    RETURNING fact_lead_score.lead_id, fact_lead_score.hot_score, fact_lead_score.cold_score
  )
  SELECT u.lead_id, u.hot_score, u.cold_score FROM upserted u;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION recompute_lead_scores() TO anon, authenticated;

-- 4. Recompute
SELECT 'Recomputing V4...' AS step;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

-- 5. New distribution (granular)
SELECT 'Cold distribution V4' AS metric;
SELECT
  CASE
    WHEN cold_score >= 90 THEN '90-100 (gần chết)'
    WHEN cold_score >= 80 THEN '80-89 (rất nguội)'
    WHEN cold_score >= 65 THEN '65-79 (nguội)'
    WHEN cold_score >= 40 THEN '40-64 (đang nguội)'
    WHEN cold_score >= 1  THEN '1-39'
    ELSE '0'
  END AS bucket,
  COUNT(*) AS count
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY bucket ORDER BY MIN(cold_score) DESC;

-- 6. Sample các tier (verify đúng tier)
SELECT 'Sample tiers' AS metric;
SELECT cold_score, cold_reasons, lead_id
FROM fact_lead_score
WHERE scored_at = CURRENT_DATE AND cold_score > 0
ORDER BY RANDOM() LIMIT 5;
