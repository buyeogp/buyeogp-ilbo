-- =====================================================================
-- 030 분만사 자돈 폐사는 사진을 받지 않는다 (발주처 요구 2026-10-13)
--
-- 분만1·2동의 포유자돈·이유자돈 폐사는 현장에서 사진을 따로 받지 않는다(하루 건수가 많다).
-- V10(폐사 = 사진 또는 사유 + 24시간 보완)을 이 경우만 푼다. 포유모돈 등 나머지는 그대로.
--
--   · photo_exempt_rule  — 어느 돈사 × 축종이 예외인가. 표로 둔다(나중에 늘리거나 줄일 때 코드 무수정)
--   · mortality.photo_exempt — 트리거가 표를 보고 채운다(앱이 스스로 「예외」라고 주장할 수 없다)
--   · v10_photo_required — 예외면 사진·사유·기한 없이 통과
--   · fn_validate_report(V10-PHOTO 경고) · fn_day_close_gate(L5-5 마감 차단) — 예외 건은 세지 않는다
--
-- 두 함수는 repo 012 가 아니라 **운영 DB 의 현재 정의**(pg_get_functiondef, 2026-10-13)를 떠서
-- 그 위에 조건 한 줄씩만 더했다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

CREATE TABLE IF NOT EXISTS app.photo_exempt_rule (
  house_id    bigint NOT NULL REFERENCES app.house(id),
  category_id bigint NOT NULL REFERENCES app.pig_category(id),
  PRIMARY KEY (house_id, category_id)
);
COMMENT ON TABLE app.photo_exempt_rule IS
  '폐사 사진을 받지 않는 돈사 × 축종 (030) — 분만1·2동 포유자돈·이유자돈';

INSERT INTO app.photo_exempt_rule (house_id, category_id)
SELECT h.id, c.id
  FROM app.house h CROSS JOIN app.pig_category c
 WHERE h.code IN ('BUNMAN1', 'BUNMAN2') AND c.code IN ('SUCK', 'WEANED')
ON CONFLICT DO NOTHING;

-- 공용 마스터라 RLS 를 걸지 않는다(014 「의도적으로 RLS 를 걸지 않는 테이블」과 같다). 앱은 읽기만
GRANT SELECT ON app.photo_exempt_rule TO buyeogp_app, buyeogp_auditor;

ALTER TABLE app.mortality ADD COLUMN IF NOT EXISTS photo_exempt boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN app.mortality.photo_exempt IS
  '사진을 받지 않는 돈사 × 축종의 폐사 (030) — 트리거가 photo_exempt_rule 을 보고 채운다';

CREATE OR REPLACE FUNCTION app.fn_mortality_photo_exempt() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, sec, extensions, public AS $$
BEGIN
  NEW.photo_exempt := EXISTS (
    SELECT 1 FROM app.photo_exempt_rule r
     WHERE r.house_id = NEW.house_id AND r.category_id = NEW.category_id);
  IF NEW.photo_exempt THEN
    -- 받지 않는 사진의 보완 기한·사유는 남기지 않는다(보완 대기 목록에 뜨지 않게)
    NEW.photo_due_at := NULL;
    NEW.photo_waiver := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mortality_photo_exempt ON app.mortality;
CREATE TRIGGER trg_mortality_photo_exempt
  BEFORE INSERT OR UPDATE OF house_id, category_id, photo_due_at, photo_waiver ON app.mortality
  FOR EACH ROW EXECUTE FUNCTION app.fn_mortality_photo_exempt();

-- 이미 들어간 건도 다시 판정한다
UPDATE app.mortality m SET photo_exempt = true, photo_due_at = NULL, photo_waiver = NULL
 WHERE EXISTS (SELECT 1 FROM app.photo_exempt_rule r
                WHERE r.house_id = m.house_id AND r.category_id = m.category_id);

ALTER TABLE app.mortality DROP CONSTRAINT IF EXISTS v10_photo_required;
ALTER TABLE app.mortality ADD CONSTRAINT v10_photo_required CHECK (
    photo_url IS NOT NULL
    OR photo_exempt
    OR (photo_waiver IS NOT NULL AND photo_due_at IS NOT NULL)
);

CREATE OR REPLACE FUNCTION app.fn_validate_report(p_report_id bigint)
 RETURNS TABLE(rule_code text, severity app.exception_severity, pen_id bigint, pen_code text, message text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'app', 'sec', 'extensions', 'public'
AS $function$
DECLARE
  rep record;
BEGIN
  SELECT dr.*, h.name AS house_name, h.count_basis INTO rep
    FROM daily_report dr JOIN house h ON h.id = dr.house_id
   WHERE dr.id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '일보를 찾을 수 없습니다 (id=%)', p_report_id;
  END IF;

  -- L1-COMPLETE : 미입력 행이 있으면 제출할 수 없다 (§8.1 빈칸과 0의 구분)
  -- 「모든 행」의 정의는 돈사마다 다르다 (house.count_basis)
  IF rep.count_basis IN ('pen', 'pen_category') THEN
    RETURN QUERY
      SELECT 'L1-COMPLETE', 'block'::exception_severity, p.id, p.code,
             format('%s 돈방이 입력되지 않았습니다. 변동이 없으면 0 을 입력하십시오', p.code)
        FROM pen p
       WHERE p.house_id = rep.house_id
         AND p.active_from <= rep.report_date
         AND (p.active_to IS NULL OR p.active_to >= rep.report_date)
         AND NOT EXISTS (SELECT 1 FROM pen_daily pd
                          WHERE pd.report_id = p_report_id AND pd.pen_id = p.id);
  END IF;

  IF rep.count_basis = 'pen_category' THEN
    -- 분만사 : 돈방 x 축종구분 전 조합
    RETURN QUERY
      SELECT 'L1-COMPLETE-CAT', 'block'::exception_severity, p.id, p.code,
             format('%s 돈방의 %s 행이 입력되지 않았습니다', p.code, c.name)
        FROM pen p
        CROSS JOIN house_category hc
        JOIN pig_category c ON c.id = hc.category_id
       WHERE p.house_id = rep.house_id AND hc.house_id = rep.house_id AND hc.active
         AND p.active_from <= rep.report_date
         AND (p.active_to IS NULL OR p.active_to >= rep.report_date)
         AND NOT EXISTS (SELECT 1 FROM pen_daily pd
                          WHERE pd.report_id = p_report_id
                            AND pd.pen_id = p.id AND pd.category_id = hc.category_id);
  ELSIF rep.count_basis = 'category' THEN
    -- 종부/임신사 : 돈방 없이 축종구분 행만
    RETURN QUERY
      SELECT 'L1-COMPLETE-CAT', 'block'::exception_severity, NULL::bigint, c.name,
             format('%s 행이 입력되지 않았습니다. 변동이 없으면 0 을 입력하십시오', c.name)
        FROM house_category hc
        JOIN pig_category c ON c.id = hc.category_id
       WHERE hc.house_id = rep.house_id AND hc.active
         AND NOT EXISTS (SELECT 1 FROM pen_daily pd
                          WHERE pd.report_id = p_report_id
                            AND pd.category_id = hc.category_id);
  ELSIF rep.count_basis = 'house' THEN
    RETURN QUERY
      SELECT 'L1-COMPLETE', 'block'::exception_severity, NULL::bigint, rep.house_name,
             format('%s 두수 행이 입력되지 않았습니다', rep.house_name)
       WHERE NOT EXISTS (SELECT 1 FROM pen_daily pd WHERE pd.report_id = p_report_id);
  END IF;

  -- V7 : 폐사 두수 = 사유별 합
  RETURN QUERY
    SELECT 'V7-DEAD', 'block'::exception_severity, pd.pen_id,
           COALESCE(p.code, c.name, rep.house_name),
           format('폐사 두수 불일치 — 일보 %s두 / 폐사등록 %s두', pd.dead_head, x.s)
      FROM pen_daily pd
      LEFT JOIN pen p ON p.id = pd.pen_id
      LEFT JOIN pig_category c ON c.id = pd.category_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(m.head_count), 0) AS s FROM mortality m
         WHERE m.house_id = pd.house_id
           AND m.pen_id      IS NOT DISTINCT FROM pd.pen_id
           AND m.batch_id    IS NOT DISTINCT FROM pd.batch_id
           AND m.category_id IS NOT DISTINCT FROM pd.category_id
           AND m.event_date = pd.report_date) x
     WHERE pd.report_id = p_report_id AND pd.dead_head <> x.s;

  RETURN QUERY
    SELECT 'V7-CULL', 'block'::exception_severity, pd.pen_id,
           COALESCE(p.code, cat.name, rep.house_name),
           format('도태 두수 불일치 — 일보 %s두 / 도태등록 %s두', pd.culled_head, x.s)
      FROM pen_daily pd
      LEFT JOIN pen p ON p.id = pd.pen_id
      LEFT JOIN pig_category cat ON cat.id = pd.category_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(c.head_count), 0) AS s FROM culling c
         WHERE c.house_id = pd.house_id
           AND c.pen_id      IS NOT DISTINCT FROM pd.pen_id
           AND c.batch_id    IS NOT DISTINCT FROM pd.batch_id
           AND c.category_id IS NOT DISTINCT FROM pd.category_id
           AND c.event_date = pd.report_date) x
     WHERE pd.report_id = p_report_id AND pd.culled_head <> x.s;

  -- 원장에는 있으나 일보 행이 없는 폐사·도태 (fn_resolve_batch 가 넘긴 고아 건)
  RETURN QUERY
    SELECT 'V7-ORPHAN', 'block'::exception_severity, m.pen_id, COALESCE(p.code, rep.house_name),
           format('폐사 %s두가 등록되었으나 해당 돈방의 일보 행이 없습니다', m.head_count)
      FROM mortality m
      LEFT JOIN pen p ON p.id = m.pen_id
     WHERE m.house_id = rep.house_id AND m.event_date = rep.report_date
       AND NOT EXISTS (SELECT 1 FROM pen_daily pd
                        WHERE pd.report_id = p_report_id
                          AND pd.pen_id      IS NOT DISTINCT FROM m.pen_id
                          AND pd.batch_id    IS NOT DISTINCT FROM m.batch_id
                          AND pd.category_id IS NOT DISTINCT FROM m.category_id);

  -- V10 : 폐사 사진 미첨부 (제출은 경고, 마감은 차단)
  RETURN QUERY
    SELECT 'V10-PHOTO', 'warn'::exception_severity, m.pen_id, COALESCE(p.code, rep.house_name),
           format('폐사 사진 미첨부 — %s. 24시간 내 보완하십시오',
                  COALESCE(m.photo_waiver, '사유 없음'))
      FROM mortality m
      LEFT JOIN pen p ON p.id = m.pen_id
     WHERE m.house_id = rep.house_id AND m.event_date = rep.report_date
       AND m.photo_url IS NULL AND NOT m.photo_exempt;

  -- L3 / V8 : 이 돈사가 발신한 이동이 아직 대사되지 않음
  RETURN QUERY
    SELECT 'V8-PENDING', 'block'::exception_severity, mv.from_pen_id, p.code,
           format('이동 미대사 (%s) — 발신 %s두 / 수령 %s두',
                  mv.status, mv.total_head,
                  COALESCE((SELECT SUM(ml.head_count) FROM movement_line ml
                             WHERE ml.movement_id = mv.id), 0))
      FROM movement mv
      JOIN pen p ON p.id = mv.from_pen_id
     WHERE p.house_id = rep.house_id
       AND mv.event_date = rep.report_date
       AND mv.status IN ('pending','disputed');

  -- L3 : 이 돈사가 수령해야 할 이동이 남아 있음 (수령 대기함)
  RETURN QUERY
    SELECT 'V8-INBOX', 'block'::exception_severity, mv.from_pen_id, fp.code,
           format('수령 대기 — %s %s방에서 %s두 발신', fh.name, fp.code, mv.total_head)
      FROM movement mv
      JOIN pen   fp ON fp.id = mv.from_pen_id
      JOIN house fh ON fh.id = fp.house_id
     WHERE mv.to_house_id = rep.house_id
       AND mv.event_date = rep.report_date
       AND mv.status = 'pending';

  RETURN;
END $function$;

CREATE OR REPLACE FUNCTION app.fn_day_close_gate(p_farm_id bigint, p_date date)
 RETURNS TABLE(rule_code text, message text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'app', 'sec', 'extensions', 'public'
AS $function$
BEGIN
  -- 1. 전 돈사 일보 확정
  RETURN QUERY
    SELECT 'L5-1', format('%s 일보가 확정되지 않았습니다 (%s)', h.name,
                          COALESCE(dr.status::text, '미작성'))
      FROM house h LEFT JOIN daily_report dr
        ON dr.house_id = h.id AND dr.report_date = p_date
     WHERE h.farm_id = p_farm_id AND h.active
       AND COALESCE(dr.status, 'draft') NOT IN ('confirmed','locked');

  -- 2. pending / disputed 이동 0건
  RETURN QUERY
    SELECT 'L5-2', format('이동 미대사 — movement id=%s, 상태 %s, 발신 %s두',
                          mv.id, mv.status, mv.total_head)
      FROM movement mv
     WHERE mv.farm_id = p_farm_id AND mv.event_date = p_date
       AND mv.status IN ('pending','disputed');

  -- 3. 미해소 경고 0건
  RETURN QUERY
    SELECT 'L5-3', format('[%s] %s', e.rule_code, e.message)
      FROM exception_queue e
     WHERE e.farm_id = p_farm_id AND e.event_date = p_date
       AND e.status = 'open' AND e.severity IN ('warn','block');

  -- 4. 실사 불일치 전건 사유 기록 (컬럼 CHECK 로 이미 강제되나 마감에서 재확인)
  RETURN QUERY
    SELECT 'L5-4', format('%s 돈방 실사 불일치 사유 미기재', p.code)
      FROM pen_daily pd JOIN pen p ON p.id = pd.pen_id
     WHERE pd.farm_id = p_farm_id AND pd.report_date = p_date
       AND pd.reported_closing_head IS NOT NULL AND pd.variance <> 0
       AND pd.variance_reason IS NULL;

  -- 5. 폐사 사진 미첨부 0건
  RETURN QUERY
    SELECT 'L5-5', format('%s 폐사 %s두 사진 미첨부', p.code, m.head_count)
      FROM mortality m JOIN pen p ON p.id = m.pen_id
     WHERE m.farm_id = p_farm_id AND m.event_date = p_date AND m.photo_url IS NULL
       AND NOT m.photo_exempt;

  RETURN;
END $function$;
