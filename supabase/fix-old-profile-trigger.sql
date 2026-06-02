-- ============================================================
-- Fix: Drop old `handle_new_user` trigger conflict
-- ------------------------------------------------------------
-- Auth Logs cho thấy:
--   "failed to close prepared statement: relation \"profiles\""
--
-- Trigger cũ `handle_new_user` từ schema.sql cố INSERT vào profiles
-- nhưng RLS chặn (không có INSERT policy). Tất cả transaction abort
-- → user mới không thể signup qua Google OAuth.
--
-- Fix: Drop trigger cũ. Multi-tenant model dùng account/account_member,
-- không cần profiles. (Bảng profiles vẫn giữ để giữ FK dim_lead.assignee_id.)
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Verify: chỉ còn trigger account
SELECT trigger_name, event_object_table, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'auth' AND event_object_table = 'users';

SELECT '✅ Đã drop trigger handle_new_user. Thử login Google lại.' AS status;
