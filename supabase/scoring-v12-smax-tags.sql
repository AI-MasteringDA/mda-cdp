-- ============================================================================
-- V12: SMAX tag là tín hiệu Sales ngang hàng với SF Rating
-- ----------------------------------------------------------------------------
-- Vấn đề V11: chỉ đọc sf_rating. Giàu gắn "Hot Lead" trên SMAX mỗi ngày nhưng
-- CDP hoàn toàn bỏ qua → lead Sales đã xác nhận NÓNG lại nằm ở MÁT/LẠNH.
--
-- V12:
--   1. Tag SMAX (Hot/Warm/Cold Lead) = tín hiệu Sales, cùng trọng số SF Rating.
--   2. Lead có BẤT KỲ nguồn nào nói "Hot" → NÓNG (lấy tín hiệu MẠNH NHẤT,
--      không cộng dồn: SF Hot + SMAX Hot vẫn là +45, không phải +90).
--   3. Tag KHÔNG phải điều kiện duy nhất — hành vi đủ mạnh vẫn NÓNG như cũ
--      (submit form 3 ngày = +50, chat 3 ngày = +35, ...).
--   4. Tag SMAX lưu cả tên hiển thị lẫn alias ("Hot Lead" và "hot-lead") nên
--      so khớp phải chuẩn hoá: bỏ dấu cách/gạch, hạ chữ thường.
-- ============================================================================

DROP FUNCTION IF EXISTS recompute_lead_scores();

CREATE FUNCTION recompute_lead_scores()
RETURNS TABLE (out_lead_id UUID, out_score INT, out_tier TEXT) AS $$
BEGIN
  RETURN QUERY
  WITH signals AS (
    SELECT l.lead_id AS lid,
      l.sf_rating,
      -- Chuẩn hoá tag SMAX: "Hot Lead" và "hot-lead" → "hotlead"
      EXISTS (SELECT 1 FROM unnest(COALESCE(l.smax_tags, '{}')) t
              WHERE lower(regexp_replace(t, '[\s_-]', '', 'g')) = 'hotlead')  AS smax_hot,
      EXISTS (SELECT 1 FROM unnest(COALESCE(l.smax_tags, '{}')) t
              WHERE lower(regexp_replace(t, '[\s_-]', '', 'g')) = 'warmlead') AS smax_warm,
      EXISTS (SELECT 1 FROM unnest(COALESCE(l.smax_tags, '{}')) t
              WHERE lower(regexp_replace(t, '[\s_-]', '', 'g')) = 'coldlead') AS smax_cold,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_chat_at)) / 86400, 9999) AS chat_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_chat_staff_at)) / 86400, 9999) AS reply_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_at)) / 86400, 9999) AS email_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_click_at)) / 86400, 9999) AS click_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_email_reply_at)) / 86400, 9999) AS ereply_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_form_submit_at)) / 86400, 9999) AS form_days,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_login_at)) / 86400, 9999) AS login_days,
      l.chat_staff_count AS staff_total, l.chat_count AS chat_total,
      l.form_submit_count AS forms_total, l.email_reply_count AS ereply_total,
      l.email_click_count AS click_total, l.email_open_count AS opens,
      l.email_received_count AS emails_sent, l.conversion_count AS conversions,
      l.web_page_view_count AS web_views,
      (
        SELECT COUNT(DISTINCT ft.source) FROM fact_touchpoint ft
        WHERE ft.lead_id = l.lead_id
          AND ft.source IN ('smax','salesforce','instantly','web','fanpage')
          AND ft.event_type IN ('chat','email_click','email_reply','form_submit','conversion')
      ) AS lead_source_count,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - l.last_engagement_at)) / 86400, 9999) AS silent_days,
      (l.chat_count + l.email_click_count + l.email_reply_count + l.form_submit_count + l.conversion_count) > 0 AS has_lead_engagement
    FROM dim_lead l WHERE l.stage != 'Đã chốt'
  ),
  -- Gộp tín hiệu Sales từ 2 nguồn: lấy MẠNH NHẤT, không cộng dồn
  sales_signal AS (
    SELECT s.*,
      (s.sf_rating = 'Hot'  OR s.smax_hot)  AS sales_hot,
      (s.sf_rating = 'Warm' OR s.smax_warm) AS sales_warm,
      -- Cold chỉ tính khi KHÔNG có nguồn nào nói Hot/Warm
      ((s.sf_rating = 'Cold' OR s.smax_cold)
        AND NOT (s.sf_rating = 'Hot' OR s.smax_hot)
        AND NOT (s.sf_rating = 'Warm' OR s.smax_warm)) AS sales_cold
    FROM signals s
  ),
  computed AS (
    SELECT s.*, 40 +
      -- ⭐ SALES-VERIFIED: SF Rating HOẶC tag SMAX (Giàu gắn) — cùng trọng số
      (CASE
        WHEN s.sales_hot  THEN 45
        WHEN s.sales_warm THEN 20
        WHEN s.sales_cold THEN -20
        ELSE 0
      END) +
      -- 🔥 Lead chat inbound
      (CASE WHEN s.chat_total > 0 AND s.chat_days <= 3 THEN 35 WHEN s.chat_total > 0 AND s.chat_days <= 7 THEN 25 WHEN s.chat_total > 0 AND s.chat_days <= 14 THEN 15 WHEN s.chat_total > 0 AND s.chat_days <= 30 THEN 5 ELSE 0 END) +
      -- 🔥 Lead reply email
      (CASE WHEN s.ereply_total > 0 AND s.ereply_days <= 3 THEN 30 WHEN s.ereply_total > 0 AND s.ereply_days <= 7 THEN 22 WHEN s.ereply_total > 0 AND s.ereply_days <= 14 THEN 15 WHEN s.ereply_total > 0 AND s.ereply_days <= 30 THEN 5 ELSE 0 END) +
      -- 🔥 Lead click email
      (CASE WHEN s.click_total > 0 AND s.click_days <= 3 THEN 25 WHEN s.click_total > 0 AND s.click_days <= 7 THEN 18 WHEN s.click_total > 0 AND s.click_days <= 14 THEN 10 WHEN s.click_total > 0 AND s.click_days <= 30 THEN 3 ELSE 0 END) +
      -- 🔥 Submit form (intent cao nhất)
      (CASE WHEN s.forms_total > 0 AND s.form_days <= 3 THEN 50 WHEN s.forms_total > 0 AND s.form_days <= 7 THEN 35 WHEN s.forms_total > 0 AND s.form_days <= 14 THEN 20 WHEN s.forms_total > 0 AND s.form_days <= 30 THEN 10 ELSE 0 END) +
      -- 🌡 Login gần đây
      (CASE WHEN s.login_days <= 3 THEN 15 WHEN s.login_days <= 7 THEN 10 WHEN s.login_days <= 30 THEN 5 ELSE 0 END) +
      -- ☀ Mở email
      (CASE WHEN s.opens >= 3 AND s.email_days <= 7 THEN 8 WHEN s.email_days <= 7 THEN 2 WHEN s.email_days <= 14 THEN 1 ELSE 0 END) +
      -- ☀ TVV vừa nhắn
      (CASE WHEN s.reply_days <= 3 THEN 10 WHEN s.reply_days <= 7 THEN 7 WHEN s.reply_days <= 14 THEN 4 WHEN s.reply_days <= 30 THEN 2 ELSE 0 END) +
      -- 🌡 Lead chủ động ở nhiều kênh
      (CASE WHEN s.lead_source_count >= 3 THEN 30 WHEN s.lead_source_count >= 2 THEN 20 ELSE 0 END) +
      (CASE WHEN s.staff_total >= 10 THEN 10 ELSE 0 END) +
      (CASE WHEN s.conversions > 0 THEN 25 ELSE 0 END) +
      (CASE WHEN s.emails_sent >= 5 AND s.opens::FLOAT / NULLIF(s.emails_sent, 0) > 0.3 THEN 12 WHEN s.emails_sent >= 10 AND s.opens = 0 THEN -10 ELSE 0 END) +
      -- Phạt im lặng — miễn cho lead Sales đã xác nhận NÓNG (họ có thể chat Zalo mình không track)
      (CASE
        WHEN s.sales_hot THEN 0
        WHEN s.silent_days <= 30 THEN 0
        WHEN s.silent_days <= 90 THEN -20
        WHEN s.silent_days <= 180 THEN -40
        ELSE -60
      END) +
      (CASE WHEN NOT s.has_lead_engagement AND NOT s.sales_hot THEN -15 ELSE 0 END) AS raw_score
    FROM sales_signal s
  ),
  clamped AS (
    SELECT c.lid, GREATEST(0, LEAST(100, c.raw_score))::INT AS score,
      (SELECT jsonb_agg(reason ORDER BY (reason->>'points')::int DESC) FROM (
        -- Tín hiệu Sales (ghi rõ nguồn nào nói)
        SELECT jsonb_build_object('sign','+','label',
          CASE WHEN c.sf_rating = 'Hot' AND c.smax_hot THEN '⭐ Sales tag NÓNG (SF + SMAX)'
               WHEN c.smax_hot THEN '⭐ SMAX: Giàu tag Hot Lead'
               ELSE '⭐ SF: Sales tag Hot' END,
          'points',45) AS reason WHERE c.sales_hot
        UNION ALL SELECT jsonb_build_object('sign','+','label',
          CASE WHEN c.smax_warm THEN '🌡 SMAX: tag Warm Lead' ELSE '🌡 SF: Sales tag Warm' END,
          'points',20) WHERE c.sales_warm
        UNION ALL SELECT jsonb_build_object('sign','-','label','❄️ Sales tag Cold','points',20) WHERE c.sales_cold
        -- Hành vi mạnh
        UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Lead chat trong 3 ngày','points',35) WHERE c.chat_total > 0 AND c.chat_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Lead reply email 3 ngày','points',30) WHERE c.ereply_total > 0 AND c.ereply_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Lead click email 3 ngày','points',25) WHERE c.click_total > 0 AND c.click_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🔥 Submit form 3 ngày','points',50) WHERE c.forms_total > 0 AND c.form_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🌡 Submit form 7 ngày','points',35) WHERE c.forms_total > 0 AND c.form_days > 3 AND c.form_days <= 7
        UNION ALL SELECT jsonb_build_object('sign','+','label','🌐 Login recent','points',15) WHERE c.login_days <= 3
        -- Hành vi yếu
        UNION ALL SELECT jsonb_build_object('sign','+','label','📧 Mở email nhiều lần (>=3)','points',8) WHERE c.opens >= 3 AND c.email_days <= 7
        UNION ALL SELECT jsonb_build_object('sign','+','label','📧 Mở email 1 lần','points',2) WHERE c.opens < 3 AND c.email_days <= 7
        UNION ALL SELECT jsonb_build_object('sign','+','label','💬 TVV vừa chat','points',10) WHERE c.reply_days <= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','💬 TVV chat trong tuần','points',7) WHERE c.reply_days > 3 AND c.reply_days <= 7
        UNION ALL SELECT jsonb_build_object('sign','+','label','🎯 LEAD engaged 3+ nguồn','points',30) WHERE c.lead_source_count >= 3
        UNION ALL SELECT jsonb_build_object('sign','+','label','🎯 LEAD engaged 2 nguồn','points',20) WHERE c.lead_source_count = 2
        UNION ALL SELECT jsonb_build_object('sign','+','label','🏆 Repeat customer','points',25) WHERE c.conversions > 0
        UNION ALL SELECT jsonb_build_object('sign','+','label','⭐ Open rate > 30%','points',12) WHERE c.emails_sent >= 5 AND c.opens::FLOAT / NULLIF(c.emails_sent, 0) > 0.3
        -- Phạt
        UNION ALL SELECT jsonb_build_object('sign','-','label','😴 Im lặng 30-90 ngày','points',20) WHERE c.silent_days > 30 AND c.silent_days <= 90 AND NOT c.sales_hot
        UNION ALL SELECT jsonb_build_object('sign','-','label','😴 Im lặng 90-180 ngày','points',40) WHERE c.silent_days > 90 AND c.silent_days <= 180 AND NOT c.sales_hot
        UNION ALL SELECT jsonb_build_object('sign','-','label','😴 Im lặng > 180 ngày','points',60) WHERE c.silent_days > 180 AND NOT c.sales_hot
        UNION ALL SELECT jsonb_build_object('sign','-','label','❌ Chưa có LEAD engagement thật','points',15) WHERE NOT c.has_lead_engagement AND NOT c.sales_hot
        UNION ALL SELECT jsonb_build_object('sign','-','label','📭 Nhận email không mở','points',10) WHERE c.emails_sent >= 10 AND c.opens = 0
      ) reasons_subq) AS reasons_json
    FROM computed c
  ),
  upserted AS (
    INSERT INTO fact_lead_score (lead_id, scored_at, hot_score, cold_score, hot_reasons, cold_reasons)
    SELECT cl.lid, CURRENT_DATE, cl.score, GREATEST(0, 100 - cl.score), COALESCE(cl.reasons_json, '[]'::jsonb), '[]'::jsonb
    FROM clamped cl
    ON CONFLICT (lead_id, scored_at) DO UPDATE SET
      hot_score = EXCLUDED.hot_score,
      cold_score = EXCLUDED.cold_score,
      hot_reasons = EXCLUDED.hot_reasons,
      cold_reasons = EXCLUDED.cold_reasons
    RETURNING fact_lead_score.lead_id, fact_lead_score.hot_score
  )
  SELECT u.lead_id, u.hot_score::INT,
    CASE WHEN u.hot_score >= 70 THEN 'NONG' WHEN u.hot_score >= 40 THEN 'AM' ELSE 'LANH' END
  FROM upserted u;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION recompute_lead_scores() TO anon, authenticated;

-- Chạy lại scoring ngay
SELECT COUNT(*) FILTER (WHERE out_tier = 'NONG') AS nong,
       COUNT(*) FILTER (WHERE out_tier = 'AM')   AS am,
       COUNT(*) FILTER (WHERE out_tier = 'LANH') AS lanh
FROM recompute_lead_scores();
