-- ============================================================
-- workspace_secret — workspace-shared secret storage
-- ------------------------------------------------------------
-- Cho phép user paste API key (Anthropic, etc.) vào UI và lưu chung
-- cho cả workspace, không cần mỗi máy/user setup riêng.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workspace_secret (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Key name — vd: "anthropic_api_key" */
  key_name text NOT NULL,
  /** Plaintext value — store within workspace boundary; service-role only access */
  value text NOT NULL,
  /** Last 4 chars for safe display in UI (vd: "...xkj7") */
  display_hint text,
  metadata jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_email text,
  UNIQUE (key_name)
);

CREATE INDEX IF NOT EXISTS workspace_secret_key_idx ON public.workspace_secret(key_name);

-- Service role bypasses RLS; only API endpoints (server-side) read raw values.
-- Authenticated users can SELECT to know if key is set (presence check) but
-- cannot read raw `value` — we only return display_hint to UI.
ALTER TABLE public.workspace_secret ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_secret_no_client_read ON public.workspace_secret;
CREATE POLICY workspace_secret_no_client_read
  ON public.workspace_secret FOR SELECT TO authenticated
  USING (false);  -- block client direct read; force going through API

-- Service role has full access (default RLS bypass)
GRANT ALL ON public.workspace_secret TO service_role;
GRANT ALL ON public.workspace_secret TO postgres;

NOTIFY pgrst, 'reload schema';
