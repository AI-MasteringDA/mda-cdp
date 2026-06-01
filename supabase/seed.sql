-- ============================================================
-- MDA Platform — Seed Data (mock cho V1, thay thế bằng ETL ở V2)
-- ------------------------------------------------------------
-- Chạy SAU schema.sql trong Supabase SQL Editor.
-- File này insert 8 lead + touchpoints + scores để app có data
-- chảy thật từ Supabase (thay vì mock-data.ts).
-- An toàn chạy nhiều lần (idempotent qua ON CONFLICT).
-- ============================================================

-- Clear cũ (chỉ data, không động schema)
TRUNCATE TABLE fact_lead_score, fact_touchpoint, dim_lead, scoring_rule CASCADE;

-- ------------------------------------------------------------
-- 1. Scoring rules (Vòng 2 rule-based)
-- ------------------------------------------------------------
INSERT INTO scoring_rule (variant, signal, signal_label, operator, threshold, weight, time_window, enabled) VALUES
  ('hot', 'email_open_count', 'Mở email Instantly', '>', 3, 25, '7d', true),
  ('hot', 'page_view_pricing', 'Xem trang Bảng giá', '>=', 1, 30, '7d', true),
  ('hot', 'chat_initiated_count', 'Chủ động chat SMAX', '>=', 1, 20, '7d', true),
  ('hot', 'form_submit', 'Submit form tải tài liệu', '>=', 1, 15, '7d', true),
  ('cold', 'days_since_last_contact', 'Số ngày từ chạm gần nhất', '>', 7, 35, '30d', true),
  ('cold', 'email_open_rate_drop', 'Ngừng mở email', '>', 5, 25, '30d', true),
  ('cold', 'deal_stage_age_days', 'Deal đứng stage quá lâu', '>', 14, 30, '30d', true);

-- ------------------------------------------------------------
-- 2. Leads (5 nóng + 3 nguội)
-- ------------------------------------------------------------
INSERT INTO dim_lead (lead_id, email, phone, full_name, source, avatar_color, stage, last_touch_at, first_seen_at) VALUES
  ('11111111-1111-1111-1111-111111111001', 'an.nguyen@gmail.com',       '+84 901 234 567', 'Nguyễn Văn An',         'fanpage',     '#FFE5D9', 'Đang cân nhắc', NOW() - INTERVAL '3 hours',   NOW() - INTERVAL '14 days'),
  ('11111111-1111-1111-1111-111111111002', 'ngoc.tranthi@outlook.com',  '+84 912 555 888', 'Trần Thị Bích Ngọc',   'fanpage',     '#FFE3F0', 'Đang tư vấn',   NOW() - INTERVAL '5 hours',   NOW() - INTERVAL '7 days'),
  ('11111111-1111-1111-1111-111111111003', 'dat.phamquoc@gmail.com',    '+84 938 222 110', 'Phạm Quốc Đạt',         'web',         '#E0F2FE', 'Mới',           NOW() - INTERVAL '12 hours',  NOW() - INTERVAL '5 days'),
  ('11111111-1111-1111-1111-111111111004', 'phuong.le@yahoo.com',       '+84 977 010 234', 'Lê Hồng Phương',        'salesforce',  '#DCFCE7', 'Đang cân nhắc', NOW() - INTERVAL '18 hours',  NOW() - INTERVAL '21 days'),
  ('11111111-1111-1111-1111-111111111005', 'linh.hoangmai@gmail.com',   '+84 905 678 999', 'Hoàng Mai Linh',        'fanpage',     '#FEF3C7', 'Đang tư vấn',   NOW() - INTERVAL '22 hours',  NOW() - INTERVAL '9 days'),
  ('11111111-1111-1111-1111-111111111101', 'tuan.vu@gmail.com',         '+84 909 111 222', 'Vũ Anh Tuấn',           'salesforce',  '#EDE9FE', 'Im lặng',       NOW() - INTERVAL '9 days',    NOW() - INTERVAL '45 days'),
  ('11111111-1111-1111-1111-111111111102', 'ha.dangthu@hotmail.com',    '+84 938 444 777', 'Đặng Thu Hà',           'fanpage',     '#FCE7F3', 'Im lặng',       NOW() - INTERVAL '14 days',   NOW() - INTERVAL '35 days'),
  ('11111111-1111-1111-1111-111111111103', 'dung.bt@gmail.com',         '+84 901 999 333', 'Bùi Tiến Dũng',         'instantly',   '#E0E7FF', 'Im lặng',       NOW() - INTERVAL '7 days',    NOW() - INTERVAL '28 days'),
  ('11111111-1111-1111-1111-111111111006', 'minh.tran@gmail.com',       '+84 906 888 222', 'Trần Minh',             'fanpage',     '#FFE5D9', 'Mới',           NOW() - INTERVAL '6 hours',   NOW() - INTERVAL '3 days'),
  ('11111111-1111-1111-1111-111111111007', 'hong.nguyen@outlook.com',   '+84 938 111 444', 'Nguyễn Thị Hồng',       'web',         '#FFE3F0', 'Đang tư vấn',   NOW() - INTERVAL '8 hours',   NOW() - INTERVAL '11 days');

-- ------------------------------------------------------------
-- 3. Touchpoints (timeline 360)
-- ------------------------------------------------------------
INSERT INTO fact_touchpoint (lead_id, source, event_type, title, detail, occurred_at) VALUES
  -- Lead 001: Nguyễn Văn An
  ('11111111-1111-1111-1111-111111111001', 'web',        'page_view',   'Xem trang Bảng giá khóa Power BI', '/courses/power-bi/pricing',       NOW() - INTERVAL '2 hours'),
  ('11111111-1111-1111-1111-111111111001', 'instantly',  'email_open',  'Mở email: Lộ trình học Data Analyst', NULL,                            NOW() - INTERVAL '5 hours'),
  ('11111111-1111-1111-1111-111111111001', 'smax',       'chat',        'Hỏi về thời gian học buổi tối', 'Lớp tối thứ 7 có còn chỗ không ạ?', NOW() - INTERVAL '8 hours'),
  ('11111111-1111-1111-1111-111111111001', 'instantly',  'email_click', 'Click link tài liệu mẫu', NULL,                                       NOW() - INTERVAL '26 hours'),
  ('11111111-1111-1111-1111-111111111001', 'salesforce', 'call',        'Tư vấn viên gọi - 4 phút', NULL,                                      NOW() - INTERVAL '48 hours'),
  ('11111111-1111-1111-1111-111111111001', 'web',        'form_submit', 'Đăng ký nhận tài liệu lộ trình', NULL,                                NOW() - INTERVAL '72 hours'),
  -- Lead 002: Trần Thị Bích Ngọc
  ('11111111-1111-1111-1111-111111111002', 'web',        'page_view',   'Xem Bảng giá khóa SQL', NULL,                                         NOW() - INTERVAL '1 hour'),
  ('11111111-1111-1111-1111-111111111002', 'smax',       'chat',        'Hỏi về tài liệu sau khóa', NULL,                                       NOW() - INTERVAL '5 hours'),
  ('11111111-1111-1111-1111-111111111002', 'instantly',  'email_open',  'Mở email: Roadmap Data', NULL,                                         NOW() - INTERVAL '10 hours'),
  -- Lead 003: Phạm Quốc Đạt
  ('11111111-1111-1111-1111-111111111003', 'web',        'page_view',   'Đọc blog: Lộ trình từ 0 đến Data Analyst', NULL,                       NOW() - INTERVAL '4 hours'),
  ('11111111-1111-1111-1111-111111111003', 'web',        'page_view',   'Xem trang khóa Python for Data', NULL,                                 NOW() - INTERVAL '6 hours'),
  -- Lead 004: Lê Hồng Phương
  ('11111111-1111-1111-1111-111111111004', 'instantly',  'email_open',  'Mở email: Ưu đãi khóa T6', NULL,                                       NOW() - INTERVAL '8 hours'),
  ('11111111-1111-1111-1111-111111111004', 'salesforce', 'call',        'Gọi tư vấn không bắt máy', NULL,                                       NOW() - INTERVAL '24 hours'),
  -- Lead 005: Hoàng Mai Linh
  ('11111111-1111-1111-1111-111111111005', 'web',        'form_submit', 'Tải tài liệu Lộ trình BI', NULL,                                       NOW() - INTERVAL '10 hours'),
  ('11111111-1111-1111-1111-111111111005', 'web',        'page_view',   'Bảng giá khóa Tableau', NULL,                                          NOW() - INTERVAL '30 hours'),
  -- Lead 101-103 (nguội)
  ('11111111-1111-1111-1111-111111111101', 'salesforce', 'call',        'Tư vấn lần 2 - không phản hồi', NULL,                                   NOW() - INTERVAL '9 days'),
  ('11111111-1111-1111-1111-111111111101', 'instantly',  'email_open',  'Mở email theo dõi', NULL,                                              NOW() - INTERVAL '10 days'),
  ('11111111-1111-1111-1111-111111111102', 'salesforce', 'call',        'Tư vấn lần đầu - 12 phút', NULL,                                       NOW() - INTERVAL '14 days'),
  ('11111111-1111-1111-1111-111111111103', 'instantly',  'email_click', 'Click link trong email', NULL,                                         NOW() - INTERVAL '7 days');

-- ------------------------------------------------------------
-- 4. Scores (chạy 1 lần cho hôm nay)
-- ------------------------------------------------------------
INSERT INTO fact_lead_score (lead_id, scored_at, hot_score, cold_score, hot_reasons, cold_reasons) VALUES
  ('11111111-1111-1111-1111-111111111001', CURRENT_DATE, 92, 12, '["Mở 4 email", "Click bảng giá", "Chat chủ động 2 lần"]'::jsonb, '[]'::jsonb),
  ('11111111-1111-1111-1111-111111111002', CURRENT_DATE, 88, 18, '["Click bảng giá 3 lần", "Chat hỏi học phí"]'::jsonb, '[]'::jsonb),
  ('11111111-1111-1111-1111-111111111003', CURRENT_DATE, 81, 22, '["Đọc 3 bài blog", "Xem trang khóa Python"]'::jsonb, '[]'::jsonb),
  ('11111111-1111-1111-1111-111111111004', CURRENT_DATE, 76, 28, '["Mở 5 email gần nhất"]'::jsonb, '[]'::jsonb),
  ('11111111-1111-1111-1111-111111111005', CURRENT_DATE, 74, 30, '["Xem 2 lần bảng giá", "Tải tài liệu"]'::jsonb, '[]'::jsonb),
  ('11111111-1111-1111-1111-111111111006', CURRENT_DATE, 65, 25, '["Mới đăng ký"]'::jsonb, '[]'::jsonb),
  ('11111111-1111-1111-1111-111111111007', CURRENT_DATE, 58, 32, '["Đang trao đổi"]'::jsonb, '[]'::jsonb),
  ('11111111-1111-1111-1111-111111111101', CURRENT_DATE, 24, 86, '[]'::jsonb, '["Không phản hồi 9 ngày", "Ngừng mở email", "Deal đứng stage 3 tuần"]'::jsonb),
  ('11111111-1111-1111-1111-111111111102', CURRENT_DATE, 18, 82, '[]'::jsonb, '["Đã tư vấn 14 ngày trước", "Không mở email 10 ngày"]'::jsonb),
  ('11111111-1111-1111-1111-111111111103', CURRENT_DATE, 22, 78, '[]'::jsonb, '["Bỏ ngỏ 7 ngày", "Click 1 lần rồi im"]'::jsonb);

-- ------------------------------------------------------------
-- 5. Sync jobs history (cho trang /sync-jobs)
-- ------------------------------------------------------------
INSERT INTO sync_job (source, started_at, finished_at, status, records_in, records_merged) VALUES
  ('salesforce', NOW() - INTERVAL '3 hours',  NOW() - INTERVAL '3 hours'  + INTERVAL '42 seconds', 'success', 421, 418),
  ('smax',       NOW() - INTERVAL '2 hours',  NOW() - INTERVAL '2 hours'  + INTERVAL '18 seconds', 'success', 1245, 1245),
  ('instantly',  NOW() - INTERVAL '28 hours', NOW() - INTERVAL '28 hours' + INTERVAL '5 seconds',  'failed',  0, 0),
  ('salesforce', NOW() - INTERVAL '27 hours', NOW() - INTERVAL '27 hours' + INTERVAL '51 seconds', 'success', 503, 498),
  ('smax',       NOW() - INTERVAL '26 hours', NOW() - INTERVAL '26 hours' + INTERVAL '22 seconds', 'success', 1812, 1810),
  ('instantly',  NOW() - INTERVAL '52 hours', NOW() - INTERVAL '52 hours' + INTERVAL '35 seconds', 'success', 2210, 2208),
  ('salesforce', NOW() - INTERVAL '51 hours', NOW() - INTERVAL '51 hours' + INTERVAL '49 seconds', 'success', 412, 410),
  ('lark',       NOW() - INTERVAL '1 hour',   NOW() - INTERVAL '1 hour'   + INTERVAL '1 seconds',  'success', 7, 7);

UPDATE sync_job SET error_message = 'HTTP 429 — rate limit' WHERE status = 'failed';
