-- ============================================================
-- Scoring V3 — fix calibration của V2
-- ------------------------------------------------------------
-- Bug V2:
--   1. silent_after_chat dùng MAX(chat date) → NULL cho lead chưa chat
--      → COALESCE với first_seen_at = NOW() (do ETL) → 0 ngày → rule không fire
--   2. Cold cap = 25 (chỉ silent_after_email fire)
--   3. 151 lead ở 30-39 mass, threshold warm = 40 → bỏ sót
--
-- V3 fix:
--   - Disable silent_after_chat (rule lỗi do data, không phải logic)
--   - Add 3 rule cold dùng MAX(any touchpoint date) — dùng được data thực
--   - Warm threshold điều chỉnh ở UI (40 → 30)
-- ============================================================

-- 1. Disable rule cũ
UPDATE scoring_rule SET enabled = false WHERE signal = 'silent_after_chat';

-- 2. Add 3 cold rule mới
INSERT INTO scoring_rule (variant, signal, signal_label, operator, threshold, weight, time_window, enabled) VALUES
  ('cold', 'days_since_last_touchpoint', 'Im lặng > 14 ngày (mọi kênh)',  '>', 14, 30, '30d', true),
  ('cold', 'days_since_last_touchpoint', 'Im lặng > 30 ngày (rất nguội)', '>', 30, 30, '90d', true),
  ('cold', 'days_since_last_touchpoint', 'Im lặng > 90 ngày (xem xét đóng)', '>', 90, 25, '180d', true)
ON CONFLICT DO NOTHING;

-- 3. Recreate function với signal mới
DROP FUNCTION IF EXISTS recompute_lead_scores();

CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_hot INT, out_cold INT) AS $$
BEGIN
  RETURN QUERY
  WITH
  signals AS (
    SELECT
      l.lead_id AS lid,
      -- HOT signals
      COUNT(*) FILTER (
        WHERE t.event_type = 'chat'
        AND t.occurred_at > NOW() - INTERVAL '3 days'
      ) AS chat_initiated_count,
      COUNT(*) FILTER (
        WHERE t.event_type = 'chat_staff'
        AND t.occurred_at > NOW() - INTERVAL '3 days'
      ) AS chat_staff_count_3d,
      COUNT(*) FILTER (
        WHERE t.event_type = 'chat_staff'
        AND t.occurred_at > NOW() - INTERVAL '90 days'
      ) AS chat_staff_total,
      COUNT(*) FILTER (
        WHERE t.event_type = 'email_sent'
        AND t.occurred_at > NOW() - INTERVAL '7 days'
      ) AS email_sent_recent,
      COUNT(*) FILTER (
        WHERE t.occurred_at > NOW() - INTERVAL '90 days'
        AND t.event_type IN ('chat','chat_staff','email_sent','email_open','email_click','call','meeting','note','form_submit','page_view')
      ) AS total_engagement,
      COUNT(DISTINCT t.source) FILTER (
        WHERE t.source IN ('smax','salesforce','instantly','web','fanpage')
      ) AS multi_source,
      -- COLD signals
      -- NEW: days_since_last_touchpoint = ngày từ touchpoint cuối CÙNG (mọi loại, mọi nguồn)
      -- Nếu lead có touchpoint → dùng MAX(occurred_at) thật
      -- Nếu lead không có touchpoint → 9999 (= rất nguội)
      COALESCE(
        EXTRACT(EPOCH FROM (NOW() - MAX(t.occurred_at))) / 86400,
        9999
      ) AS days_since_last_touchpoint,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(
        MAX(t.occurred_at) FILTER (WHERE t.event_type IN ('chat','chat_staff')),
        l.first_seen_at
      ))) / 86400 AS silent_after_chat,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(
        MAX(t.occurred_at) FILTER (WHERE t.event_type = 'email_sent'),
        l.first_seen_at
      ))) / 86400 AS silent_after_email,
      CASE
        WHEN COUNT(*) FILTER (
          WHERE t.event_type IN ('chat','chat_staff','email_sent','email_open','email_click','call','meeting','conversion')
        ) = 0 THEN 1 ELSE 0
      END AS never_engaged,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(l.last_touch_at, l.first_seen_at))) / 86400 AS days_since_last_contact
    FROM dim_lead l
    LEFT JOIN fact_touchpoint t ON t.lead_id = l.lead_id
    WHERE l.stage != 'Đã chốt'
    GROUP BY l.lead_id, l.last_touch_at, l.first_seen_at
  ),
  rule_matches AS (
    SELECT
      s.lid, r.variant, r.weight, r.signal_label,
      CASE r.signal
        WHEN 'chat_initiated_count'         THEN s.chat_initiated_count
        WHEN 'chat_staff_count_3d'          THEN s.chat_staff_count_3d
        WHEN 'chat_staff_total'             THEN s.chat_staff_total
        WHEN 'email_sent_recent'            THEN s.email_sent_recent
        WHEN 'total_engagement'             THEN s.total_engagement
        WHEN 'multi_source'                 THEN s.multi_source
        WHEN 'silent_after_chat'            THEN s.silent_after_chat
        WHEN 'silent_after_email'           THEN s.silent_after_email
        WHEN 'never_engaged'                THEN s.never_engaged
        WHEN 'days_since_last_contact'      THEN s.days_since_last_contact
        WHEN 'days_since_last_touchpoint'   THEN s.days_since_last_touchpoint
        ELSE 0
      END AS signal_value,
      r.operator, r.threshold
    FROM signals s
    CROSS JOIN scoring_rule r
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
SELECT 'Recomputing V3...' AS step;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

-- 5. New distribution
SELECT 'Hot distribution V3' AS metric;
SELECT
  CASE
    WHEN hot_score >= 70 THEN '70-100 HOT'
    WHEN hot_score >= 30 THEN '30-69 WARM'
    WHEN hot_score >= 10 THEN '10-29 mild'
    ELSE '0-9 none'
  END AS bucket,
  COUNT(*) AS count
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY bucket ORDER BY bucket;

SELECT 'Cold distribution V3' AS metric;
SELECT
  CASE
    WHEN cold_score >= 70 THEN '70-100 COLD'
    WHEN cold_score >= 50 THEN '50-69'
    WHEN cold_score >= 30 THEN '30-49'
    WHEN cold_score >= 10 THEN '10-29'
    ELSE '0-9 none'
  END AS bucket,
  COUNT(*) AS count
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY bucket ORDER BY bucket;
