-- ============================================================
-- DEV MODE — relax RLS để anon đọc + ghi được
-- ------------------------------------------------------------
-- Idempotent: chạy nhiều lần không lỗi.
-- KHI lên prod: rollback file này, dùng schema.sql gốc với
-- policies riêng cho từng role (TVV chỉ thấy lead của mình).
-- ============================================================

-- Drop tất cả policies cũ (cả "authenticated" cũ và "dev" mới)
DROP POLICY IF EXISTS "authenticated read all" ON profiles;
DROP POLICY IF EXISTS "authenticated read all" ON dim_lead;
DROP POLICY IF EXISTS "authenticated read all" ON fact_touchpoint;
DROP POLICY IF EXISTS "authenticated read all" ON fact_lead_score;
DROP POLICY IF EXISTS "authenticated read all" ON sync_job;
DROP POLICY IF EXISTS "authenticated read all" ON scoring_rule;
DROP POLICY IF EXISTS "authenticated read all" ON ai_audit;
DROP POLICY IF EXISTS "authenticated read all" ON lark_alert;

DROP POLICY IF EXISTS "dev read all" ON profiles;
DROP POLICY IF EXISTS "dev read all" ON dim_lead;
DROP POLICY IF EXISTS "dev read all" ON fact_touchpoint;
DROP POLICY IF EXISTS "dev read all" ON fact_lead_score;
DROP POLICY IF EXISTS "dev read all" ON sync_job;
DROP POLICY IF EXISTS "dev read all" ON scoring_rule;
DROP POLICY IF EXISTS "dev read all" ON ai_audit;
DROP POLICY IF EXISTS "dev read all" ON lark_alert;

DROP POLICY IF EXISTS "dev update scoring_rule" ON scoring_rule;
DROP POLICY IF EXISTS "dev insert score" ON fact_lead_score;
DROP POLICY IF EXISTS "dev update score" ON fact_lead_score;

-- ------------------------------------------------------------
-- READ policies — anon + authenticated đều đọc được
-- ------------------------------------------------------------
CREATE POLICY "dev read all" ON profiles
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "dev read all" ON dim_lead
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "dev read all" ON fact_touchpoint
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "dev read all" ON fact_lead_score
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "dev read all" ON sync_job
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "dev read all" ON scoring_rule
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "dev read all" ON ai_audit
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "dev read all" ON lark_alert
  FOR SELECT TO anon, authenticated USING (true);

-- ------------------------------------------------------------
-- WRITE policies — cho phép UI toggle rule + engine recompute scores
-- ------------------------------------------------------------
CREATE POLICY "dev update scoring_rule" ON scoring_rule
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "dev insert score" ON fact_lead_score
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "dev update score" ON fact_lead_score
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
