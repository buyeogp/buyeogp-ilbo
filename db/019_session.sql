-- =====================================================================
-- 019 세션 — 설계문서 §6.4 / §6.7
--
-- 세션을 DB 에 둔다. 서명 쿠키만으로는 두 가지를 못 한다.
--   · 무조작 자동 잠금 (현장 15분 / 본사 30분) — 마지막 활동 시각이 필요하다
--   · 즉시 로그아웃·강제 해지 — 서명 쿠键는 만료 전까지 유효하다
-- 사용자가 22명이라 DB 조회 비용은 문제가 되지 않는다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

CREATE TABLE sec.session (
  id           uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id      bigint NOT NULL REFERENCES sec.app_user(id) ON DELETE CASCADE,
  -- 쿠키에는 원본을, DB 에는 해시를 둔다. DB 가 새도 세션을 도용할 수 없다.
  token_hash   bytea NOT NULL UNIQUE,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- 역할에 따라 다르다. 현장 15분 / 본사 30분 (§6.7)
  idle_limit_s int NOT NULL,
  -- 무조작이 아니어도 이 시각이 지나면 다시 로그인한다
  absolute_exp timestamptz NOT NULL,
  ip           inet,
  user_agent   text,
  revoked_at   timestamptz,
  revoke_reason text,
  CHECK (idle_limit_s BETWEEN 60 AND 86400)
);

COMMENT ON TABLE sec.session IS
  '로그인 세션. 계정 공유 금지가 추적성과 SoD 의 전제이므로(§6.4)
   한 사용자가 여러 곳에서 동시에 열어 두면 화면에서 보이게 한다';
COMMENT ON COLUMN sec.session.token_hash IS
  'sha256(쿠키 원본). 원본은 저장하지 않는다';

CREATE INDEX ON sec.session (user_id, last_seen_at DESC);
CREATE INDEX ON sec.session (absolute_exp) WHERE revoked_at IS NULL;

-- 살아 있는 세션만 보여 주는 뷰. 만료 판정을 한 곳에서만 한다.
CREATE VIEW sec.v_active_session AS
SELECT s.*,
       u.login_id, u.name, u.status AS user_status,
       s.last_seen_at + make_interval(secs => s.idle_limit_s) AS idle_exp
  FROM sec.session s
  JOIN sec.app_user u ON u.id = s.user_id
 WHERE s.revoked_at IS NULL
   AND s.absolute_exp > now()
   AND s.last_seen_at + make_interval(secs => s.idle_limit_s) > now()
   AND u.status = 'active';

-- ── 로그인 실패 잠금 (§6.7) ──────────────────────────────────────────
-- 같은 계정에 짧은 시간 안에 실패가 몰리면 막는다. login_attempt 를 그대로 쓴다.
CREATE FUNCTION sec.fn_login_locked(p_login_id text, p_window_min int DEFAULT 15,
                                    p_max_fail int DEFAULT 5)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = app, sec, extensions, public AS $$
  SELECT count(*) >= p_max_fail
    FROM sec.login_attempt a
   WHERE a.login_id = p_login_id
     AND NOT a.success
     AND a.attempted_at > now() - make_interval(mins => p_window_min)
     AND NOT EXISTS (                       -- 마지막 성공 이후의 실패만 센다
       SELECT 1 FROM sec.login_attempt s2
        WHERE s2.login_id = a.login_id AND s2.success
          AND s2.attempted_at > a.attempted_at);
$$;

COMMENT ON FUNCTION sec.fn_login_locked IS
  '15분 안에 5회 실패하면 잠근다. 성공하면 카운트가 초기화된다';

-- ── 정리 ─────────────────────────────────────────────────────────────
-- 만료 세션은 감사 가치가 없다. 주기적으로 지운다 (pg_cron 또는 앱에서 호출).
CREATE FUNCTION sec.fn_purge_sessions(p_keep_days int DEFAULT 7)
RETURNS int
LANGUAGE plpgsql SET search_path = app, sec, extensions, public AS $$
DECLARE n int;
BEGIN
  DELETE FROM sec.session
   WHERE absolute_exp < now() - make_interval(days => p_keep_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ── 권한 ─────────────────────────────────────────────────────────────
-- 애플리케이션은 세션을 직접 다룬다. admin 은 해지만 할 수 있어야 한다.
GRANT SELECT, INSERT, UPDATE, DELETE ON sec.session TO buyeogp_app;
GRANT SELECT ON sec.v_active_session TO buyeogp_app;
GRANT SELECT, UPDATE (revoked_at, revoke_reason) ON sec.session TO buyeogp_admin;
GRANT EXECUTE ON FUNCTION sec.fn_login_locked, sec.fn_purge_sessions TO buyeogp_app;
