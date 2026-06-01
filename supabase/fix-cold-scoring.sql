-- ============================================================
-- Fix Cold Scoring — bump weights + nới threshold để cold lead
-- hit >=70 với data hiện có.
--
-- Sau khi chạy: SELECT recompute_lead_scores();
-- ============================================================

-- Tăng weight rule "days_since_last_contact" từ 35 → 50 + nới op
UPDATE scoring_rule
SET weight = 50, operator = '>=', threshold = 7
WHERE signal = 'days_since_last_contact';

-- Thêm rule mới: lead 14+ ngày không liên hệ = cực nguội
INSERT INTO scoring_rule (variant, signal, signal_label, operator, threshold, weight, time_window, enabled)
VALUES ('cold', 'days_since_last_contact', 'Quá 14 ngày không liên hệ', '>=', 14, 30, '30d', true)
ON CONFLICT DO NOTHING;

-- Recompute
SELECT * FROM recompute_lead_scores() ORDER BY out_cold DESC, out_hot DESC;
