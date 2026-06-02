-- ============================================================
-- MDA Scoring Engine V2 — dùng real signals từ data hiện có
-- ------------------------------------------------------------
-- Vấn đề V1: Rules dựa email_open/click/page_view/form_submit
-- nhưng chưa có webhook → toàn bộ hot_score = 0
--
-- V2 dùng signals đã có thật trong DB:
--   - chat_3d            : lead gửi tin trong 3 ngày (cực nóng)
--   - chat_staff_3d      : TVV reply trong 3 ngày
--   - email_sent_recent  : MDA gửi email trong 7 ngày (đang nuôi)
--   - total_engagement   : tổng touchpoint >= 5 (engaged)
--   - multi_source       : lead xuất hiện ở >= 2 sources (cross-channel)
--   - silent_after_chat  : chat lần cuối >7d → COLD
--   - silent_after_email : email lần cuối >14d, ko chat → COLD
--   - never_engaged      : chỉ có lead_created cũ → COLD weak
-- ============================================================

-- Bước 1: Disable rules cũ (không phải xóa, để rollback được)
UPDATE scoring_rule SET enabled = false
WHERE signal IN ('email_open_count', 'email_click_count', 'page_view_pricing', 'form_submit', 'email_open_rate_drop', 'deal_stage_age_days');

-- Bước 2: Update + thêm rule mới
-- chat_initiated_count vẫn dùng, nhưng đổi sang 3 ngày
UPDATE scoring_rule
SET threshold = 0, operator = '>', weight = 35,
    signal_label = 'Lead chat trong 3 ngày qua'
WHERE signal = 'chat_initiated_count';

INSERT INTO scoring_rule (variant, signal, signal_label, operator, threshold, weight, time_window, enabled) VALUES
  ('hot',  'chat_staff_count_3d',  'TVV đã reply trong 3 ngày',          '>',  0, 20, '3d',  true),
  ('hot',  'chat_staff_total',     'TVV đã chat tổng >= 5 lần',          '>=', 5, 15, '90d', true),
  ('hot',  'email_sent_recent',    'MDA gửi email trong 7 ngày qua',     '>',  0, 10, '7d',  true),
  ('hot',  'total_engagement',     'Tổng tương tác >= 5',                '>=', 5, 15, '90d', true),
  ('hot',  'multi_source',         'Xuất hiện ở >= 2 kênh (đa kênh)',    '>=', 2, 20, '90d', true),
  ('cold', 'silent_after_chat',    'Im lặng >7 ngày sau lần chat cuối',  '>',  7, 40, '30d', true),
  ('cold', 'silent_after_email',   'Đã nhận email nhưng im lặng >14d',   '>',  14, 25,'30d', true),
  ('cold', 'never_engaged',        'Chỉ tạo Lead, chưa từng chat/email','=',  1, 20, '90d', true)
ON CONFLICT DO NOTHING;

-- Bước 3: Drop + recreate function với signals mới
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
        AND t.event_type IN ('chat','chat_staff','email_sent','email_open','email_click','call','meeting','note')
      ) AS total_engagement,
      COUNT(DISTINCT t.source) FILTER (
        WHERE t.source IN ('smax','salesforce','instantly','web','fanpage')
      ) AS multi_source,
      -- COLD signals
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
    WHERE l.stage != 'Đã chốt'  -- đã chốt không cần score
    GROUP BY l.lead_id, l.last_touch_at, l.first_seen_at
  ),
  rule_matches AS (
    SELECT
      s.lid,
      r.variant,
      r.weight,
      r.signal_label,
      CASE r.signal
        WHEN 'chat_initiated_count'    THEN s.chat_initiated_count
        WHEN 'chat_staff_count_3d'     THEN s.chat_staff_count_3d
        WHEN 'chat_staff_total'        THEN s.chat_staff_total
        WHEN 'email_sent_recent'       THEN s.email_sent_recent
        WHEN 'total_engagement'        THEN s.total_engagement
        WHEN 'multi_source'            THEN s.multi_source
        WHEN 'silent_after_chat'       THEN s.silent_after_chat
        WHEN 'silent_after_email'      THEN s.silent_after_email
        WHEN 'never_engaged'           THEN s.never_engaged
        WHEN 'days_since_last_contact' THEN s.days_since_last_contact
        ELSE 0
      END AS signal_value,
      r.operator,
      r.threshold
    FROM signals s
    CROSS JOIN scoring_rule r
    WHERE r.enabled = true
  ),
  matched AS (
    SELECT
      rm.lid,
      rm.variant,
      rm.weight,
      rm.signal_label
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
    SELECT
      fs.lid, CURRENT_DATE, fs.hot_score, fs.cold_score, fs.hot_reasons, fs.cold_reasons
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

-- Bước 4: Recompute
SELECT 'Recomputing...' AS step;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

-- Bước 5: Distribution sau update
SELECT 'Hot score distribution' AS metric;
SELECT
  CASE
    WHEN hot_score = 0 THEN '0'
    WHEN hot_score < 30 THEN '1-29'
    WHEN hot_score < 50 THEN '30-49'
    WHEN hot_score < 70 THEN '50-69'
    WHEN hot_score < 90 THEN '70-89'
    ELSE '90-100'
  END AS bucket,
  COUNT(*) AS count
FROM fact_lead_score
WHERE scored_at = CURRENT_DATE
GROUP BY bucket
ORDER BY bucket;

SELECT 'Cold score distribution' AS metric;
SELECT
  CASE
    WHEN cold_score = 0 THEN '0'
    WHEN cold_score < 30 THEN '1-29'
    WHEN cold_score < 50 THEN '30-49'
    WHEN cold_score < 70 THEN '50-69'
    WHEN cold_score < 90 THEN '70-89'
    ELSE '90-100'
  END AS bucket,
  COUNT(*) AS count
FROM fact_lead_score
WHERE scored_at = CURRENT_DATE
GROUP BY bucket
ORDER BY bucket;

-- Bước 6: Top 10 hot leads (để verify)
SELECT 'Top 10 HOT leads' AS metric;
SELECT
  l.full_name,
  l.stage,
  s.hot_score,
  s.hot_reasons,
  l.lead_id
FROM fact_lead_score s
JOIN dim_lead l ON l.lead_id = s.lead_id
WHERE s.scored_at = CURRENT_DATE
ORDER BY s.hot_score DESC, s.cold_score ASC
LIMIT 10;
