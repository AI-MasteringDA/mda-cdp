-- ============================================================
-- Fix SMAX touchpoint titles — đẹp hơn cho UI
-- ============================================================

-- Các chat có message = "attach" → tệp đính kèm
UPDATE fact_touchpoint
SET
  title = 'Đã gửi tệp đính kèm',
  detail = 'Không có nội dung text (file/ảnh/sticker)'
WHERE source = 'smax'
  AND (title = 'Chat: attach' OR title = 'Chat: attach...');

-- Các chat có message rỗng
UPDATE fact_touchpoint
SET title = 'Đã tương tác chat (không có text)'
WHERE source = 'smax'
  AND (title = 'Chat: (no message)' OR title LIKE 'Chat: %' AND detail IS NULL);

-- Show kết quả
SELECT
  title,
  COUNT(*) AS count
FROM fact_touchpoint
WHERE source = 'smax'
GROUP BY title
ORDER BY count DESC
LIMIT 20;
