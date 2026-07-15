-- ============================================================================
-- data_health_snapshot: lịch sử "sức khỏe" data để phát hiện sụt bất thường
-- ----------------------------------------------------------------------------
-- Mỗi lần health-check chạy, ghi 1 dòng số liệu hiện tại. Lần sau so với ĐỈNH
-- 7 ngày gần nhất — nếu tụt sâu (VD 9,000 → 1,300 như sự cố 2026-07-14) thì
-- bắn cảnh báo Lark. So với đỉnh (không phải dòng trước) để không báo động giả
-- khi data tăng-giảm nhẹ tự nhiên.
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_health_snapshot (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source       TEXT        NOT NULL,          -- smax / salesforce / instantly / web / _total
  touchpoints  INT         NOT NULL DEFAULT 0,
  leads        INT         NOT NULL DEFAULT 0,
  last_event_at TIMESTAMPTZ                    -- tin/sự kiện mới nhất của source
);

CREATE INDEX IF NOT EXISTS idx_health_source_time
  ON data_health_snapshot (source, captured_at DESC);

-- Dọn snapshot cũ > 30 ngày (giữ bảng nhỏ) — chạy kèm mỗi lần insert trong code.
