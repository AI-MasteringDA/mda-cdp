-- ============================================================
-- Fix: Trigger `handle_new_user_account` không tìm thấy `account_member`
-- ------------------------------------------------------------
-- Lỗi: "relation account_member does not exist (42P01)"
-- Nguyên nhân: SECURITY DEFINER chạy với search_path của function owner,
--             không phải user. Khi trigger fire từ auth.users → search_path
--             default = '$user, public' nhưng có thể schema 'public' không
--             được resolve.
-- Fix: Schema-qualify table names (public.account, public.account_member)
--      hoặc SET search_path trên function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user_account() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  new_account_id UUID;
BEGIN
  -- Skip nếu user đã có account membership (e.g. được mời)
  IF EXISTS (SELECT 1 FROM public.account_member WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Tạo workspace
  INSERT INTO public.account (name, owner_email)
  VALUES (
    COALESCE(NEW.raw_user_meta_data->>'workspace_name', 'Workspace của ' || NEW.email),
    NEW.email
  )
  RETURNING id INTO new_account_id;

  -- Thêm user làm owner
  INSERT INTO public.account_member (account_id, user_id, role)
  VALUES (new_account_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

-- Recreate trigger (drop + create để chắc chắn)
DROP TRIGGER IF EXISTS on_auth_user_created_account ON auth.users;
CREATE TRIGGER on_auth_user_created_account
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_account();

-- Verify
SELECT 'Triggers on auth.users:' AS info;
SELECT trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE event_object_schema = 'auth' AND event_object_table = 'users';

SELECT '✅ Trigger fixed with explicit schema. Test login Google lại.' AS status;
