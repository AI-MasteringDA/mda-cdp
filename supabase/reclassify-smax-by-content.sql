-- ============================================================
-- Reclassify existing SMAX chat by message content heuristic
-- ------------------------------------------------------------
-- Backfill cho touchpoints cũ không có field sender_is_staff
-- Phát hiện TVV broadcast pattern qua từ ngữ phổ biến:
--   - Mở đầu "Em chào", "em báo", "em xin"
--   - Hỏi "anh/chị" (xưng em với khách)
--   - Mention "khóa học", "ưu đãi", "Mastering"
--   - Format "TVV:", "Sales:", "MDA:"
-- ============================================================

UPDATE fact_touchpoint
SET
  event_type = 'chat_staff',
  title = REPLACE(title, 'Chat: ', 'TVV chat: ')
WHERE source = 'smax'
  AND event_type = 'chat'
  AND (
    -- TVV opening phrases
    title ILIKE '%Để em có thể%'
    OR title ILIKE '%Em chào%'
    OR title ILIKE '%em xin%'
    OR title ILIKE '%em báo%'
    OR title ILIKE '%em gửi%'
    OR title ILIKE '%em là tư vấn%'
    OR title ILIKE '%em hỗ trợ%'
    -- TVV addressing customer
    OR title ILIKE '%cho chị ạ%'
    OR title ILIKE '%cho anh ạ%'
    OR title ILIKE '%anh/chị%'
    -- TVV sales pitch
    OR title ILIKE '%ưu đãi%'
    OR title ILIKE '%voucher%'
    OR title ILIKE '%giảm giá%'
    OR title ILIKE '%đăng ký%'
    OR title ILIKE '%khóa học%'
    -- Prefix patterns
    OR title ILIKE 'Chat: Mastering%'
    OR title ILIKE 'Chat: MDA%'
    OR title ILIKE 'Chat: Sales%'
    OR title ILIKE 'Chat: TVV%'
  );

-- Show result
SELECT 'Reclassified by content heuristic' AS step;
SELECT event_type, COUNT(*) FROM fact_touchpoint
WHERE source = 'smax'
GROUP BY event_type;

-- Sample what got reclassified
SELECT 'Sample 10 reclassified messages' AS step;
SELECT title FROM fact_touchpoint
WHERE source = 'smax' AND event_type = 'chat_staff'
ORDER BY RANDOM()
LIMIT 10;

-- Recompute aggregates + scores
SELECT 'Recomputing...' AS step;
SELECT recompute_lead_aggregates() AS aggregates_updated;
SELECT COUNT(*) AS total_scored FROM recompute_lead_scores();

-- New tier distribution
SELECT 'New tier distribution' AS step;
SELECT lead_tier(hot_score) AS tier, COUNT(*) AS count, MIN(hot_score) AS min, MAX(hot_score) AS max
FROM fact_lead_score WHERE scored_at = CURRENT_DATE
GROUP BY tier ORDER BY min DESC;
