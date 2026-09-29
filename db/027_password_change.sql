-- =====================================================================
-- 027 비밀번호 — 처음 로그인하면 바꾸게 하기 · 본인 변경
--
-- 재발급한 비밀번호는 발급한 사람도 알고, 전달하는 동안 메모지·메시지에 남는다.
-- 그 비밀번호를 계속 쓰면 「한 사람 한 계정」(누가 입력했나)이 약해진다.
-- 관리 화면이 비밀번호를 만들거나 재발급하면 must_change_password = true —
-- 그 사람은 로그인한 뒤 새 비밀번호를 정하기 전까지 다른 화면을 쓸 수 없다.
--
-- 앱 계정(buyeogp_app)에는 여전히 이 열들을 고칠 권한이 없다 (SoD-3).
-- 본인 변경도 계정 관리 연결(buyeogp_admin)로 한다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

ALTER TABLE sec.app_user
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_changed_at  timestamptz;

COMMENT ON COLUMN sec.app_user.must_change_password IS
  '관리 화면이 만들거나 재발급한 비밀번호 — 본인이 바꾸기 전까지 다른 화면을 막는다 (027)';
