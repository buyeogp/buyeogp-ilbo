-- =====================================================================
-- 003 계정·권한·감사 — 설계문서 §4.12 / §6
-- sec 스키마에 둔다. SoD-3: 업무 DB 계정은 sec 를 읽기만 한다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 사용자 ───────────────────────────────────────────────────────────
CREATE TABLE sec.app_user (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  emp_no        text UNIQUE,              -- 미확보(R-C) → 시스템 자체 채번
  login_id      text NOT NULL UNIQUE,
  name          text NOT NULL,
  name_native   text,                     -- 네팔어 표기 (선택)
  nationality   text,
  phone         text,
  password_hash text NOT NULL,
  mfa_secret    text,                     -- §6.7 본사 계정 2단계 인증
  mfa_required  boolean NOT NULL DEFAULT false,
  status        user_status NOT NULL DEFAULT 'active',
  hired_at      date,
  left_at       date,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (left_at IS NULL OR hired_at IS NULL OR left_at >= hired_at)
);
COMMENT ON TABLE sec.app_user IS
  '계정 — 조직도 26.07.20판 기준 현장 18 + 본사 4. 1단계 발급은 L2 이상 7명 (§6.1).
   계정 공유 금지: 추적성과 SoD의 전제 (§6.4)';

-- ── 역할 부여 (기간) ─────────────────────────────────────────────────
CREATE TABLE sec.user_role (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES sec.app_user(id) ON DELETE CASCADE,
  role       app_role NOT NULL,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to   date,
  granted_by bigint REFERENCES sec.app_user(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  EXCLUDE USING gist (
    user_id WITH =, role WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
);

-- ── 스코프 (담당 농장·돈사) ──────────────────────────────────────────
CREATE TABLE sec.user_scope (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES sec.app_user(id) ON DELETE CASCADE,
  farm_id    bigint NOT NULL REFERENCES app.farm(id),
  house_id   bigint REFERENCES app.house(id),   -- NULL = 해당 농장 전 돈사
  valid_from date NOT NULL DEFAULT current_date,
  valid_to   date,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX ON sec.user_scope (user_id, farm_id, house_id)
  WHERE valid_to IS NULL AND house_id IS NOT NULL;
CREATE UNIQUE INDEX ON sec.user_scope (user_id, farm_id)
  WHERE valid_to IS NULL AND house_id IS NULL;
COMMENT ON TABLE sec.user_scope IS
  '담당 범위. 팀장 4인 — 배두(종부/임신/순치) · 햄(분만) · 라주(초기자돈) · 펨바(육성/비육/검정) (§6.1)';

-- ── 감사로그 (append-only) ───────────────────────────────────────────
CREATE TABLE sec.audit_log (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id     bigint REFERENCES sec.app_user(id),
  action      audit_action NOT NULL,
  table_name  text,
  pk_value    text,
  farm_id     bigint,
  before_data jsonb,
  after_data  jsonb,
  ip          inet,
  user_agent  text,
  detail      text
);
CREATE INDEX ON sec.audit_log (occurred_at DESC);
CREATE INDEX ON sec.audit_log (table_name, pk_value);
CREATE INDEX ON sec.audit_log (user_id, occurred_at DESC);
COMMENT ON TABLE sec.audit_log IS
  '전수 감사로그. append-only — 애플리케이션 DB 계정에 UPDATE/DELETE 미부여.
   보존 3년 (HACCP 기준과 동일, §6.6)';

-- 삽입 외 금지. 013_rls.sql 에서 권한도 함께 회수한다.
CREATE RULE audit_log_no_update AS ON UPDATE TO sec.audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO sec.audit_log DO INSTEAD NOTHING;

-- ── 로그인 시도 (계정 잠금·감사) ─────────────────────────────────────
CREATE TABLE sec.login_attempt (
  id         bigserial PRIMARY KEY,
  login_id   text NOT NULL,
  user_id    bigint REFERENCES sec.app_user(id),
  success    boolean NOT NULL,
  ip         inet,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sec.login_attempt (login_id, attempted_at DESC);
