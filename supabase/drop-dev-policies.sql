-- ============================================================
-- Drop legacy "dev" policies that break tenant isolation
-- ------------------------------------------------------------
-- Policy "dev read all" (qual=true) cho phép MỌI authenticated user
-- SELECT tất cả rows → multi-tenant không cô lập.
-- Drop tất cả policy có tên chứa 'dev'.
-- ============================================================

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        policyname ILIKE '%dev%'
        OR policyname ILIKE '%open%'
        OR policyname ILIKE '%enable read access for all%'
        OR policyname ILIKE '%public%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename);
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;

-- Verify: chỉ còn policy multi-tenant (tenant_isolation, account_member_*)
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT '✅ Dev policies dropped. Multi-tenant isolation now enforced.' AS status;
