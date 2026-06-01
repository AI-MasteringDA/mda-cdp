-- ============================================================
-- MDA Platform — Database Schema V1
-- ------------------------------------------------------------
-- Chạy file này trong: Supabase Dashboard → SQL Editor → New query
-- Toàn bộ schema được thiết kế cho:
--   - Cockpit (App 1) : đọc dim_lead + fact_touchpoint + fact_lead_score
--   - Growth (App 2)  : đọc fact_funnel + fact_attribution + dim_channel
--   - Ops             : đọc sync_job, ai_audit, lark_alert
-- Pattern: raw_* (data thô) → dim_* / fact_* (đã hợp nhất)
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES — gắn với auth.users của Supabase Auth
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'tvv' CHECK (role IN ('admin', 'manager', 'tvv', 'viewer')),
  avatar_color TEXT DEFAULT '#E0E7FF',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile khi user đăng ký
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ------------------------------------------------------------
-- 2. RAW LAYER — data thô từ ETL pull về, chưa hợp nhất
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_salesforce_contacts (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  full_name TEXT,
  created_at_source TIMESTAMPTZ,
  raw_data JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_smax_chats (
  id TEXT PRIMARY KEY,
  user_phone TEXT,
  message TEXT,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  occurred_at TIMESTAMPTZ,
  raw_data JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_instantly_emails (
  id TEXT PRIMARY KEY,
  lead_email TEXT,
  subject TEXT,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  raw_data JSONB,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_sf_email ON raw_salesforce_contacts(email);
CREATE INDEX IF NOT EXISTS idx_raw_smax_phone ON raw_smax_chats(user_phone);
CREATE INDEX IF NOT EXISTS idx_raw_instantly_email ON raw_instantly_emails(lead_email);

-- ------------------------------------------------------------
-- 3. DIM LAYER — chiều (đã hợp nhất danh tính)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_lead (
  lead_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  phone TEXT,
  full_name TEXT,
  source TEXT,
  avatar_color TEXT DEFAULT '#E0E7FF',
  stage TEXT DEFAULT 'Mới' CHECK (stage IN ('Mới', 'Đang tư vấn', 'Đang cân nhắc', 'Im lặng', 'Ghi danh')),
  assignee_id UUID REFERENCES profiles(id),
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_touch_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_email ON dim_lead(email);
CREATE INDEX IF NOT EXISTS idx_lead_assignee ON dim_lead(assignee_id);
CREATE INDEX IF NOT EXISTS idx_lead_stage ON dim_lead(stage);

CREATE TABLE IF NOT EXISTS dim_channel (
  channel_key TEXT PRIMARY KEY,
  channel_label TEXT NOT NULL,
  channel_category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO dim_channel (channel_key, channel_label, channel_category) VALUES
  ('google_ads', 'Google Ads', 'paid'),
  ('facebook_ads', 'Facebook Ads', 'paid'),
  ('tiktok_ads', 'TikTok Ads', 'paid'),
  ('fanpage_brand', 'Fanpage Brand', 'organic'),
  ('fanpage_phuongthao', 'Fanpage PhuongThao', 'organic'),
  ('seo', 'SEO / Organic', 'organic'),
  ('direct', 'Direct', 'direct'),
  ('referral', 'Referral', 'referral')
ON CONFLICT (channel_key) DO NOTHING;

-- ------------------------------------------------------------
-- 4. FACT LAYER — sự kiện đo lường được
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_touchpoint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES dim_lead(lead_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT,
  detail TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_touch_lead ON fact_touchpoint(lead_id);
CREATE INDEX IF NOT EXISTS idx_touch_time ON fact_touchpoint(occurred_at DESC);

CREATE TABLE IF NOT EXISTS fact_lead_score (
  lead_id UUID REFERENCES dim_lead(lead_id) ON DELETE CASCADE,
  scored_at DATE NOT NULL,
  hot_score INT DEFAULT 0,
  cold_score INT DEFAULT 0,
  hot_reasons JSONB DEFAULT '[]'::jsonb,
  cold_reasons JSONB DEFAULT '[]'::jsonb,
  PRIMARY KEY (lead_id, scored_at)
);

CREATE INDEX IF NOT EXISTS idx_score_hot ON fact_lead_score(scored_at, hot_score DESC);
CREATE INDEX IF NOT EXISTS idx_score_cold ON fact_lead_score(scored_at, cold_score DESC);

-- ------------------------------------------------------------
-- 5. OPS LAYER — vận hành
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  records_in INT DEFAULT 0,
  records_merged INT DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_time ON sync_job(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_source ON sync_job(source, started_at DESC);

CREATE TABLE IF NOT EXISTS scoring_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant TEXT NOT NULL CHECK (variant IN ('hot', 'cold')),
  signal TEXT NOT NULL,
  signal_label TEXT NOT NULL,
  operator TEXT NOT NULL CHECK (operator IN ('>', '>=', '<', '<=', '=')),
  threshold NUMERIC NOT NULL,
  weight INT NOT NULL,
  time_window TEXT NOT NULL DEFAULT '7d',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL,
  lead_id UUID REFERENCES dim_lead(lead_id),
  approver_id UUID REFERENCES profiles(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'rejected')),
  preview TEXT
);

CREATE TABLE IF NOT EXISTS lark_alert (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT NOT NULL,
  lead_id UUID REFERENCES dim_lead(lead_id),
  reason TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered BOOLEAN DEFAULT false
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_lead ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_touchpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_lead_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE lark_alert ENABLE ROW LEVEL SECURITY;

-- Policy V1: ai login đều xem được tất cả (đơn giản hóa cho V1)
-- V2 sẽ refactor: TVV chỉ thấy lead của mình
CREATE POLICY "authenticated read all" ON profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON dim_lead
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON fact_touchpoint
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON fact_lead_score
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON sync_job
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON scoring_rule
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON ai_audit
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read all" ON lark_alert
  FOR SELECT TO authenticated USING (true);
