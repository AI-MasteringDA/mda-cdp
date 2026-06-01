-- ============================================================
-- Thêm touchpoints để demo scoring engine có lead vượt ngưỡng 70
-- ------------------------------------------------------------
-- Sau khi chạy file này → SELECT recompute_lead_scores()
-- để engine tính lại.
-- ============================================================

INSERT INTO fact_touchpoint (lead_id, source, event_type, title, occurred_at) VALUES
  -- An: thêm 3 email_open → đủ điều kiện "Mở > 3" (+25), tổng 90
  ('11111111-1111-1111-1111-111111111001', 'instantly', 'email_open', 'Mở email: Bonus tài liệu mẫu',     NOW() - INTERVAL '12 hours'),
  ('11111111-1111-1111-1111-111111111001', 'instantly', 'email_open', 'Mở email: Case study học viên',   NOW() - INTERVAL '36 hours'),
  ('11111111-1111-1111-1111-111111111001', 'instantly', 'email_open', 'Mở email: Mời tham gia webinar',  NOW() - INTERVAL '60 hours'),

  -- Ngọc: thêm 3 email_open + 1 form submit
  ('11111111-1111-1111-1111-111111111002', 'instantly', 'email_open', 'Mở email: Lịch khóa T6',          NOW() - INTERVAL '20 hours'),
  ('11111111-1111-1111-1111-111111111002', 'instantly', 'email_open', 'Mở email: Tài liệu mẫu',          NOW() - INTERVAL '40 hours'),
  ('11111111-1111-1111-1111-111111111002', 'instantly', 'email_open', 'Mở email: Roadmap Data',          NOW() - INTERVAL '60 hours'),
  ('11111111-1111-1111-1111-111111111002', 'web',       'form_submit', 'Đăng ký nhận tư vấn 1-1',         NOW() - INTERVAL '14 hours'),

  -- Đạt: thêm 1 pricing view + 4 email_open
  ('11111111-1111-1111-1111-111111111003', 'web',       'page_view',  'Xem trang Bảng giá khóa Python',  NOW() - INTERVAL '3 hours'),
  ('11111111-1111-1111-1111-111111111003', 'instantly', 'email_open', 'Mở email: Welcome Lộ trình',      NOW() - INTERVAL '24 hours'),
  ('11111111-1111-1111-1111-111111111003', 'instantly', 'email_open', 'Mở email: Khóa nâng cao',         NOW() - INTERVAL '48 hours'),
  ('11111111-1111-1111-1111-111111111003', 'instantly', 'email_open', 'Mở email: Lộ trình SQL',          NOW() - INTERVAL '72 hours'),
  ('11111111-1111-1111-1111-111111111003', 'instantly', 'email_open', 'Mở email: Case study DA',         NOW() - INTERVAL '96 hours'),
  ('11111111-1111-1111-1111-111111111003', 'smax',      'chat',       'Chat hỏi về requirement',         NOW() - INTERVAL '5 hours'),

  -- Phương: thêm 4 email_open + 1 pricing
  ('11111111-1111-1111-1111-111111111004', 'instantly', 'email_open', 'Mở email: Khóa T6 ưu đãi',        NOW() - INTERVAL '16 hours'),
  ('11111111-1111-1111-1111-111111111004', 'instantly', 'email_open', 'Mở email: Demo lớp tối',          NOW() - INTERVAL '40 hours'),
  ('11111111-1111-1111-1111-111111111004', 'instantly', 'email_open', 'Mở email: Lộ trình BI',           NOW() - INTERVAL '64 hours'),
  ('11111111-1111-1111-1111-111111111004', 'instantly', 'email_open', 'Mở email: Promo giảm 15%',        NOW() - INTERVAL '88 hours'),
  ('11111111-1111-1111-1111-111111111004', 'web',       'page_view',  'Xem trang Bảng giá khóa Tableau', NOW() - INTERVAL '6 hours'),

  -- Linh: thêm 3 email_open
  ('11111111-1111-1111-1111-111111111005', 'instantly', 'email_open', 'Mở email: Welcome Tableau',       NOW() - INTERVAL '24 hours'),
  ('11111111-1111-1111-1111-111111111005', 'instantly', 'email_open', 'Mở email: Lộ trình BI',           NOW() - INTERVAL '48 hours'),
  ('11111111-1111-1111-1111-111111111005', 'instantly', 'email_open', 'Mở email: Demo công cụ',          NOW() - INTERVAL '72 hours'),
  ('11111111-1111-1111-1111-111111111005', 'smax',      'chat',       'Hỏi giảm giá cho học viên cũ',    NOW() - INTERVAL '4 hours');

-- Recompute scores ngay
SELECT * FROM recompute_lead_scores() ORDER BY out_hot DESC;
