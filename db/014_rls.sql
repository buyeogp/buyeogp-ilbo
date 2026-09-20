-- =====================================================================
-- 014 DB 역할 · Row-Level Security — 설계문서 §6.2 / §6.3 / §6.7
--
-- 이 계층이 담당하는 것: 테넌트 격리 + 담당 돈사 스코프 + admin 업무데이터 차단.
-- 상태 전이 규칙(제출·확정·마감)은 012 의 트리거가 담당한다 — 두 계층을 섞지 않는다.
--
-- 권한 검사는 서버 API 전건에서도 수행한다. RLS 는 최후 방어선이다 (§6.7).
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── DB 역할 (SoD-3: admin 은 업무 테이블 접근 불가) ──────────────────
-- 셋 다 권한만 담는 그룹 역할(NOLOGIN)이다. 실제 접속 계정은 여기에 소속시켜
-- 별도로 만든다 — 비밀번호를 저장소에 넣지 않기 위해서다 (infra/README.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buyeogp_app') THEN
    CREATE ROLE buyeogp_app     NOLOGIN;   -- 애플리케이션 서버
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buyeogp_admin') THEN
    CREATE ROLE buyeogp_admin   NOLOGIN;   -- 계정·마스터 관리 전용
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buyeogp_auditor') THEN
    CREATE ROLE buyeogp_auditor NOLOGIN;   -- HACCP 심사·감사 (읽기 전용)
  END IF;
END $$;

GRANT USAGE ON SCHEMA app, sec    TO buyeogp_app, buyeogp_auditor;
GRANT USAGE ON SCHEMA sec         TO buyeogp_admin;
GRANT USAGE ON SCHEMA extensions  TO buyeogp_app, buyeogp_admin, buyeogp_auditor;

-- 접속 시 search_path 를 고정한다 (Supabase 는 기본값이 public 뿐이다)
ALTER ROLE buyeogp_app     SET search_path = app, sec, extensions, public;
ALTER ROLE buyeogp_admin   SET search_path = sec, extensions, public;
ALTER ROLE buyeogp_auditor SET search_path = app, sec, extensions, public;

-- 애플리케이션
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA app TO buyeogp_app;
GRANT USAGE                          ON ALL SEQUENCES IN SCHEMA app TO buyeogp_app;
GRANT SELECT                         ON ALL TABLES    IN SCHEMA sec TO buyeogp_app;
GRANT INSERT                         ON sec.audit_log, sec.login_attempt TO buyeogp_app;
GRANT USAGE                          ON ALL SEQUENCES IN SCHEMA sec TO buyeogp_app;

-- 감사자 — 전체 읽기, 쓰기 금지
GRANT SELECT ON ALL TABLES IN SCHEMA app TO buyeogp_auditor;
GRANT SELECT ON ALL TABLES IN SCHEMA sec TO buyeogp_auditor;

-- 시스템 관리자 — 계정·권한만. 업무 스키마는 GRANT 하지 않는다 (SoD-3)
GRANT SELECT, INSERT, UPDATE, DELETE ON sec.app_user, sec.user_role, sec.user_scope
  TO buyeogp_admin;
GRANT SELECT ON sec.audit_log TO buyeogp_admin;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA sec TO buyeogp_admin;

-- 감사로그는 누구도 고치거나 지울 수 없다 (§6.6)
REVOKE UPDATE, DELETE, TRUNCATE ON sec.audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON sec.audit_log
  FROM buyeogp_app, buyeogp_admin, buyeogp_auditor;

-- ── 권한 판정 헬퍼 ───────────────────────────────────────────────────
-- 인자를 text[] 로 받는다. VARIADIC + enum 조합은 미지정 리터럴의 타입 해석이
-- 문맥에 따라 달라질 수 있으므로 피한다.
CREATE FUNCTION app.has_role(VARIADIC p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, sec, extensions, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sec.user_role ur
     WHERE ur.user_id = app.session_user_id()
       AND ur.role::text = ANY(p_roles)
       AND ur.valid_from <= current_date
       AND (ur.valid_to IS NULL OR ur.valid_to >= current_date));
$$;

-- 전 돈사 접근 등급 : farm_manager / hq_staff / hq_manager / auditor
CREATE FUNCTION app.is_farm_wide() RETURNS boolean
LANGUAGE sql STABLE SET search_path = app, sec, extensions, public AS $$
  SELECT app.has_role('farm_manager','hq_staff','hq_manager','auditor');
$$;

CREATE FUNCTION app.can_see_farm(p_farm_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, sec, extensions, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sec.user_scope us
     WHERE us.user_id = app.session_user_id()
       AND us.farm_id = p_farm_id
       AND us.valid_from <= current_date
       AND (us.valid_to IS NULL OR us.valid_to >= current_date));
$$;

CREATE FUNCTION app.can_see_house(p_house_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, sec, extensions, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM sec.user_scope us
      JOIN app.house h ON h.farm_id = us.farm_id
     WHERE us.user_id = app.session_user_id()
       AND h.id = p_house_id
       AND (us.house_id IS NULL OR us.house_id = p_house_id)
       AND us.valid_from <= current_date
       AND (us.valid_to IS NULL OR us.valid_to >= current_date));
$$;

-- 담당 돈사이거나 전 돈사 등급이면 참
CREATE FUNCTION app.can_write_house(p_house_id bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = app, sec, extensions, public AS $$
  SELECT app.has_role('team_lead','farm_manager') AND app.can_see_house(p_house_id);
$$;

CREATE FUNCTION app.pen_house(p_pen_id bigint) RETURNS bigint
LANGUAGE sql STABLE SET search_path = app, sec, extensions, public AS $$ SELECT house_id FROM app.pen WHERE id = p_pen_id $$;

-- ── RLS 적용 ─────────────────────────────────────────────────────────
-- 마스터 : 자기 농장만 조회. 쓰기는 마스터 관리 권한자
ALTER TABLE farm  ENABLE ROW LEVEL SECURITY;
ALTER TABLE house ENABLE ROW LEVEL SECURITY;
ALTER TABLE pen   ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_farm_read  ON farm  FOR SELECT USING (app.can_see_farm(id));
CREATE POLICY p_house_read ON house FOR SELECT USING (app.can_see_farm(farm_id));
CREATE POLICY p_pen_read   ON pen   FOR SELECT USING (app.can_see_farm(farm_id));
CREATE POLICY p_batch_all  ON batch FOR ALL
  USING (app.can_see_farm(farm_id))
  WITH CHECK (app.can_see_farm(farm_id) AND app.has_role('team_lead','farm_manager','hq_staff','hq_manager'));

CREATE POLICY p_house_write ON house FOR ALL
  USING (app.has_role('farm_manager','hq_manager','admin') AND app.can_see_farm(farm_id))
  WITH CHECK (app.has_role('farm_manager','hq_manager','admin') AND app.can_see_farm(farm_id));
CREATE POLICY p_pen_write ON pen FOR ALL
  USING (app.has_role('farm_manager','hq_manager','admin') AND app.can_see_farm(farm_id))
  WITH CHECK (app.has_role('farm_manager','hq_manager','admin') AND app.can_see_farm(farm_id));

-- 일보 : 담당 돈사만 쓰기, 농장 범위는 읽기
ALTER TABLE daily_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_report_read ON daily_report FOR SELECT
  USING (app.can_see_farm(farm_id));
CREATE POLICY p_report_insert ON daily_report FOR INSERT
  WITH CHECK (app.can_write_house(house_id));
CREATE POLICY p_report_update ON daily_report FOR UPDATE
  USING (app.can_write_house(house_id) OR app.has_role('hq_staff','hq_manager'))
  WITH CHECK (app.can_write_house(house_id) OR app.has_role('hq_staff','hq_manager'));

ALTER TABLE pen_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_pen_daily_read ON pen_daily FOR SELECT
  USING (app.can_see_farm(farm_id));
CREATE POLICY p_pen_daily_write ON pen_daily FOR ALL
  USING (app.can_write_house(app.pen_house(pen_id)) OR app.has_role('hq_staff','hq_manager'))
  WITH CHECK (app.can_write_house(app.pen_house(pen_id)) OR app.has_role('hq_staff','hq_manager'));

-- 이벤트 원장 : 농장 범위 읽기 + 담당 돈사 쓰기
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'movement','movement_line','mortality','culling','vaccination','medicine_usage',
    'feed_delivery','weaning','breeding','mating_line','breeding_action',
    'farrowing','abortion','parity_record','piglet_transfer',
    'sow','boar','shipment','exception_queue','adjustment','day_close',
    'breeding_stock_grading','medicine_request','medicine_receipt','purchase_order',
    -- 실행 검증에서 누락이 드러난 것들. 전부 farm_id 를 들고 있다
    'house_category','movement_schedule','feed_stock_monthly','medicine_stock_monthly']
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY p_%s_read ON app.%I FOR SELECT USING (app.can_see_farm(farm_id))', t, t);
    EXECUTE format(
      'CREATE POLICY p_%s_write ON app.%I FOR ALL
         USING (app.can_see_farm(farm_id)
                AND app.has_role(''team_lead'',''farm_manager'',''hq_staff'',''hq_manager''))
         WITH CHECK (app.can_see_farm(farm_id)
                AND app.has_role(''team_lead'',''farm_manager'',''hq_staff'',''hq_manager''))', t, t);
  END LOOP;
END $$;

-- SoD-4 : 마감·마감해제는 hq_manager 단독
DROP POLICY p_day_close_write ON day_close;
CREATE POLICY p_day_close_write ON day_close FOR ALL
  USING (app.can_see_farm(farm_id) AND app.has_role('hq_manager'))
  WITH CHECK (app.can_see_farm(farm_id) AND app.has_role('hq_manager'));

-- ── 일보에 딸린 테이블 ───────────────────────────────────────────────
-- farm_id 가 없고 daily_report 를 통해 테넌트가 정해진다. 부모를 따라간다.
ALTER TABLE report_comment       ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_signature ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_report_comment_all ON report_comment FOR ALL
  USING (EXISTS (SELECT 1 FROM daily_report d
                  WHERE d.id = report_id AND app.can_see_farm(d.farm_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM daily_report d
                  WHERE d.id = report_id AND app.can_see_farm(d.farm_id)));

CREATE POLICY p_submission_sig_read ON submission_signature FOR SELECT
  USING (EXISTS (SELECT 1 FROM daily_report d
                  WHERE d.id = report_id AND app.can_see_farm(d.farm_id)));
CREATE POLICY p_submission_sig_insert ON submission_signature FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM daily_report d
                  WHERE d.id = report_id AND app.can_see_farm(d.farm_id)));
-- 서명은 증거다. 남긴 뒤에는 고치거나 지울 수 없다 (§6.5)
COMMENT ON TABLE submission_signature IS
  '출력물과 시스템 데이터가 동일함을 증명한다. 로그인 세션 + content_hash (§6.5).
   UPDATE·DELETE 정책을 두지 않아 RLS 아래에서는 추가만 가능하다';

-- ── 의도적으로 RLS 를 걸지 않는 테이블 ───────────────────────────────
-- 전 농장 공용 마스터 : farm · owner · pig_category · reason_code · supplier
--                       vaccine · vaccine_schedule · medicine · feed
--                       feed_price_history · market_price
-- 부모에 종속된 라인   : medicine_request_line · medicine_receipt_line
--                       purchase_order_line
-- 이들은 테넌트 구분이 없거나 부모 행을 통해서만 도달한다.

-- 감사자는 어떤 테이블에도 쓰지 못한다 (GRANT 로 이미 차단, 정책으로 재확인)
-- 정산·출하는 본사 등급만 조회 (§6.2 출하·정산 조회 행)
ALTER TABLE settlement_shipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_monthly  ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_settle_ship ON settlement_shipment FOR ALL
  USING (app.can_see_farm(farm_id) AND app.has_role('farm_manager','hq_staff','hq_manager','auditor'))
  WITH CHECK (app.can_see_farm(farm_id) AND app.has_role('hq_staff','hq_manager'));
CREATE POLICY p_settle_month ON settlement_monthly FOR ALL
  USING (app.can_see_farm(farm_id) AND app.has_role('farm_manager','hq_staff','hq_manager','auditor'))
  WITH CHECK (app.can_see_farm(farm_id) AND app.has_role('hq_staff','hq_manager'));

-- BYPASSRLS 는 부여하지 않는다. 명시적으로 NOBYPASSRLS 를 걸고 싶어도
-- 그 속성 변경은 슈퍼유저 전용이라 관리형 PostgreSQL(Supabase)에서 실패한다.
-- 기본값이 이미 NOBYPASSRLS 이므로 아무것도 하지 않는 것이 맞다.
--
-- 주의 — 테이블 소유자는 RLS 를 우회한다(PostgreSQL 기본 동작).
--   · 마이그레이션·시드는 소유자(postgres)로 돌린다. 그래서 015/016 이 통과한다
--   · 운영 트래픽은 buyeogp_app 소속 로그인 계정으로 붙으므로 RLS 가 적용된다
--   · Supabase 대시보드 SQL 편집기는 postgres 로 동작하므로 RLS 가 걸리지 않는다.
--     거기서 한 조회·변경도 sec.audit_log 에는 전부 남는다
DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE 'ALTER ROLE buyeogp_app     NOBYPASSRLS';
    EXECUTE 'ALTER ROLE buyeogp_auditor NOBYPASSRLS';
  END IF;
END $$;

COMMENT ON FUNCTION app.has_role IS
  'user_role 의 유효기간을 반영한다. 프런트 메뉴 숨김은 UX 일 뿐이며
   실제 검사는 서버 API 와 이 정책 두 곳에서 한다 (§6.7)';
