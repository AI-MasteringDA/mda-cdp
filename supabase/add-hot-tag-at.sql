-- ============================================================================
-- hot_tag_at: thời điểm Sales gắn tag "Hot Lead" trên SMAX
-- ----------------------------------------------------------------------------
-- SMAX trả về mỗi tag kèm `time` (khi nào Giàu bấm tag), nhưng ETL chỉ lưu tên
-- tag → mất mốc thời gian đó. Cột này giữ lại để trả lời "lead này được đánh
-- giá NÓNG lúc nào".
--
-- Dùng cho bộ lọc "nóng tính đến ngày" = MAX(last_engagement_at, hot_tag_at):
-- lead tag 3 tháng trước NHƯNG vẫn đang chat → last_engagement mới → vẫn hiện;
-- lead vừa tag tuần này NHƯNG chat lần cuối đã lâu (Sales gọi điện rồi tag) →
-- hot_tag_at mới → vẫn hiện. Chỉ ẩn khi CẢ HAI đều cũ.
-- ============================================================================

ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS hot_tag_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dim_lead_hot_tag_at
  ON dim_lead (hot_tag_at) WHERE hot_tag_at IS NOT NULL;
