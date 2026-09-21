-- =====================================================================
-- 020 인증 권한 보정 — API 실동작에서 드러난 것
--
-- 로그인이 42501 로 죽었다. 앱 계정은 sec 스키마에 SELECT 만 있고
-- last_login_at 을 쓸 수 없었다. SoD-3(admin 만 계정 관리)은 지키되,
-- **운영 중에 갱신되는 열만** 열어 준다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- 마지막 로그인 시각만. 이름·권한·상태는 여전히 admin 영역이다.
GRANT UPDATE (last_login_at) ON sec.app_user TO buyeogp_app;

COMMENT ON COLUMN sec.app_user.last_login_at IS
  '앱이 갱신하는 유일한 열. 나머지는 admin 만 쓴다 (SoD-3)';

-- ── 감사 기록이 계정보다 오래 남게 한다 ──────────────────────────────
-- login_attempt·audit_log 가 app_user 를 RESTRICT 로 참조하고 있어
-- 계정을 지우면 기록 때문에 막혔다. 기록이 사라지는 것보다 낫지만,
-- 운영에서 계정은 지우지 않고 status='left' 로 둔다(§4.12).
-- 그래도 개발·시험에서 막히므로 링크만 끊고 기록은 남긴다.
ALTER TABLE sec.login_attempt
  DROP CONSTRAINT IF EXISTS login_attempt_user_id_fkey,
  ADD CONSTRAINT login_attempt_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES sec.app_user(id) ON DELETE SET NULL;

-- 감사로그는 외래키를 아예 떼어낸다.
-- append-only 를 위해 UPDATE·DELETE 를 DO INSTEAD NOTHING 으로 막아 두었는데,
-- ON DELETE SET NULL 은 FK 가 내부적으로 UPDATE 를 걸기 때문에 그 규칙에
-- 먹혀 "unexpected result" 로 실패한다. 둘은 같이 설 수 없다.
--
-- 떼어내는 쪽이 맞다. 감사 기록은 그 시점의 사실이지 현재 계정 표의 파생이
-- 아니다. 계정이 사라져도 「누가 무엇을 했다」는 남아야 한다.
ALTER TABLE sec.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;

COMMENT ON COLUMN sec.audit_log.user_id IS
  'sec.app_user.id 이지만 외래키를 걸지 않는다 — 감사 기록은 계정보다 오래 산다';

COMMENT ON COLUMN sec.login_attempt.login_id IS
  '계정이 지워져도 남는다. user_id 는 끊기지만 누가 시도했는지는 이 값에 남는다';

-- ── 앱이 만드는 세션·시도 기록 ───────────────────────────────────────
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sec TO buyeogp_app;
