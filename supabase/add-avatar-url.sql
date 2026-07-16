-- ============================================================================
-- avatar_url: ảnh đại diện thật của lead (Zalo/Facebook, từ SMAX customer.picture)
-- ----------------------------------------------------------------------------
-- SMAX trả về link ảnh có CHỮ KÝ HẾT HẠN (Zalo ?time=..., Facebook
-- ?expire=...&signature=...) — không thể lưu tĩnh một lần rồi dùng mãi, ảnh sẽ
-- vỡ sau vài tuần/tháng. Vì vậy ETL SMAX ghi đè cột này ở MỌI lần chạy (cùng
-- pass với smax_tags mirror) → link luôn tươi vì cron chạy mỗi 5-15 phút.
-- Nếu SMAX không trả picture cho customer đó, cột giữ giá trị cũ (không xoá).
-- ============================================================================

ALTER TABLE dim_lead ADD COLUMN IF NOT EXISTS avatar_url TEXT;
