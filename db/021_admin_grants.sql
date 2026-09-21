-- =====================================================================
-- 021 계정 관리 화면을 위한 권한 — 설계문서 §6.3 / §6.7
--
-- 현장에 배포한 뒤에는 개발자가 매일 붙을 수 없다. 담당 돈사가 수시로 바뀌는
-- 현장이므로 **관리자 등급을 받은 사람이 직접** 계정과 담당을 고쳐야 한다.
--
-- 그 화면이 쓸 DB 연결은 buyeogp_admin 이다. SoD-3 의 핵심 —
-- 「계정을 관리하는 연결은 업무 데이터를 보지 못한다」 — 은 그대로 둔다.
-- 여기서 여는 것은 딱 두 가지뿐이다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 1. 감사로그 기록 ─────────────────────────────────────────────────
-- 담당이 바뀐 것을 기록하지 못하면 화면을 여는 의미가 없다. 누가 언제 누구의
-- 무엇을 바꿨는지가 남아야 현장에서 자율적으로 관리할 수 있다 (§6.6).
-- UPDATE·DELETE 는 여전히 없다 — append-only 는 깨지지 않는다.
GRANT INSERT ON sec.audit_log TO buyeogp_admin;

-- ── 2. 돈사 이름 ─────────────────────────────────────────────────────
-- 「배두 → 임신1동」을 배정하려면 돈사 목록이 필요하다. 코드만 보여 주고
-- 이름을 못 보여 주면 현장이 쓸 수 없다.
--
-- 여는 것은 **마스터뿐**이다. farm·house 는 「돈사가 무엇이 있나」이지
-- 「거기 몇 마리가 있나」가 아니다. 일보·두수·폐사·출하는 계속 닫혀 있다.
GRANT USAGE  ON SCHEMA app                 TO buyeogp_admin;
GRANT SELECT ON app.farm, app.house        TO buyeogp_admin;

ALTER ROLE buyeogp_admin SET search_path = sec, app, extensions, public;

-- 확인 : 이 연결로는 일보가 보이면 안 된다.
-- (실제 거부 여부는 접속 계정으로 시켜 봐야 안다 — src/db/setup-admin-role.js)
COMMENT ON ROLE buyeogp_admin IS
  '계정·담당 관리 전용. 업무 데이터(일보·두수·폐사·출하)는 GRANT 하지 않는다 (SoD-3). '
  '마스터(farm·house)와 감사로그 기록만 열려 있다';

-- ── 3. 관리자 등급의 뜻 ──────────────────────────────────────────────
COMMENT ON TYPE app_role IS
  'worker 작업자 · team_lead 팀장 · farm_manager 현장관리 · hq_staff 본사 · '
  'hq_manager 본사관리 · auditor 감사 · '
  'admin 계정·담당 관리 권한. 직책이 아니라 **부여되는 권한**이라 팀장이 함께 가질 수 있다. '
  '부여는 본사만 한다 — 그래야 팀장이 스스로 확정 권한(hq_staff)을 가질 수 없다 (SoD-1)';

-- ── 4. 담당이 비는 것을 알아채기 위한 뷰 ─────────────────────────────
-- 사고는 대개 「아무도 담당이 아닌 돈사」에서 난다. 그 날 일보가 통째로 빠진다.
CREATE OR REPLACE VIEW sec.v_house_owner AS
  SELECT h.id           AS house_id,
         h.farm_id,
         h.code,
         h.name,
         h.seq,
         count(*) FILTER (WHERE r.role = 'team_lead')::int    AS lead_count,
         count(*) FILTER (WHERE r.role = 'farm_manager')::int AS manager_count,
         coalesce(
           jsonb_agg(DISTINCT jsonb_build_object(
             'userId', u.id, 'name', u.name, 'loginId', u.login_id,
             'role', r.role::text, 'validTo', s.valid_to))
           FILTER (WHERE u.id IS NOT NULL), '[]'::jsonb)      AS holders
    FROM app.house h
    LEFT JOIN sec.user_scope s
           ON s.farm_id = h.farm_id
          AND (s.house_id IS NULL OR s.house_id = h.id)
          AND s.valid_from <= current_date
          AND (s.valid_to IS NULL OR s.valid_to >= current_date)
    LEFT JOIN sec.app_user u
           ON u.id = s.user_id AND u.status = 'active'
    LEFT JOIN sec.user_role r
           ON r.user_id = u.id
          AND r.valid_from <= current_date
          AND (r.valid_to IS NULL OR r.valid_to >= current_date)
   WHERE h.active
   GROUP BY h.id, h.farm_id, h.code, h.name, h.seq;

GRANT SELECT ON sec.v_house_owner TO buyeogp_admin, buyeogp_app, buyeogp_auditor;

COMMENT ON VIEW sec.v_house_owner IS
  '돈사별 현재 담당자. lead_count = 0 이면 그 돈사의 일보를 쓸 사람이 없다';
