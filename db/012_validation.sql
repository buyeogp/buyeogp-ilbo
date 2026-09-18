-- =====================================================================
-- 012 검증 · 이상탐지 · 마감 게이트 — 설계문서 §5.3 ~ §5.7
--
--   app.fn_validate_report(report_id)  L1~L3 — 제출·확정 시 호출. block 1건이면 거부
--   app.fn_detect_anomalies(farm, day) L4     — 확정 후 예외큐 적재
--   app.fn_day_close_gate(farm, day)   L5     — 마감 차단 사유 목록
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ─────────────────────────────────────────────────────────────────────
-- L1 ~ L3 : 일보 단위 검증
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.fn_validate_report(p_report_id bigint)
RETURNS TABLE (rule_code text, severity exception_severity,
               pen_id bigint, pen_code text, message text)
LANGUAGE plpgsql STABLE AS $$
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
       AND m.photo_url IS NULL;

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
END $$;

COMMENT ON FUNCTION app.fn_validate_report IS
  '제출·확정 전 검증. 화면 미리보기와 저장 게이트가 같은 함수를 쓰므로
   「화면에서는 통과했는데 저장이 막힌다」가 발생하지 않는다 (§5.1)';

-- ─────────────────────────────────────────────────────────────────────
-- 상태 전이 게이트
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.fn_report_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_blocks int;
  v_first  text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- 허용 전이
  IF NOT (
       (OLD.status = 'draft'     AND NEW.status = 'submitted')
    OR (OLD.status = 'submitted' AND NEW.status IN ('draft','confirmed'))
    OR (OLD.status = 'confirmed' AND NEW.status IN ('submitted','locked'))
    OR (OLD.status = 'locked'    AND NEW.status = 'confirmed')
  ) THEN
    RAISE EXCEPTION '허용되지 않는 상태 전이입니다: % → %', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status IN ('submitted','confirmed') AND NOT app.is_migration() THEN
    SELECT count(*), min(message) INTO v_blocks, v_first
      FROM app.fn_validate_report(NEW.id) WHERE severity = 'block';
    IF v_blocks > 0 THEN
      RAISE EXCEPTION '검증 위반 %건으로 제출할 수 없습니다. 첫 건: %', v_blocks, v_first
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at := now();
  END IF;
  IF NEW.status = 'confirmed' THEN
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
    NEW.confirmed_by := COALESCE(NEW.confirmed_by, app.session_user_id());
  END IF;
  IF NEW.status = 'locked' THEN
    NEW.locked_at := COALESCE(NEW.locked_at, now());
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_report_status BEFORE UPDATE OF status ON daily_report
  FOR EACH ROW EXECUTE FUNCTION app.fn_report_status_guard();

-- ─────────────────────────────────────────────────────────────────────
-- L4 : 이상 탐지 (§5.6) — 확정 후 실행하여 예외큐에 적재
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.fn_detect_anomalies(p_farm_id bigint, p_date date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  -- §5.6 임계값
  c_mortality_rate   numeric := 0.01;   -- 일 폐사율 1% (회신 80번 정상 범위)
  c_sigma            numeric := 3;      -- 폐사 급증 평균 + 3σ
  c_swing            numeric := 0.20;   -- 두수 급변 ±20%
  c_conception       numeric := 0.90;   -- 주차 수태율 90%
  c_stillborn_rate   numeric := 0.15;   -- 사산율 15% (현행 월계 약 12%)
  c_wean_avg         numeric := 11.4;   -- 이유 복당두수 평균
  c_wean_band        numeric := 0.30;
  c_abortion_cluster int     := 3;      -- 동일 장소·주차 유산 3건
  c_flat_days        int     := 7;      -- 장기 무변동 7일
  c_stock_var        numeric := 0.03;   -- 사료 재고 대사 3%
  c_withdraw_soon    int     := 7;      -- 휴약기간 임박 7일
  c_reservice        int     := 3;      -- 재종부 3회 이상
  c_preterm_days     int     := 5;      -- 조산 판정 −5일
BEGIN
  -- 일 폐사율 초과
  INSERT INTO exception_queue (farm_id, event_date, house_id, pen_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, p.house_id, pd.pen_id, 'warn', 'L4-MORT-RATE',
         format('일 폐사율 %s%% (%s두 / 재고 %s두) — 정상 범위 1%% 초과',
                round(100.0 * pd.dead_head / NULLIF(pd.opening_head, 0), 2),
                pd.dead_head, pd.opening_head),
         'pen_daily', pd.id::text
    FROM pen_daily pd JOIN pen p ON p.id = pd.pen_id
   WHERE pd.farm_id = p_farm_id AND pd.report_date = p_date
     AND pd.opening_head > 0
     AND pd.dead_head::numeric / pd.opening_head > c_mortality_rate
  ON CONFLICT DO NOTHING;

  -- 폐사 급증 (직전 30일 평균 + 3σ)
  INSERT INTO exception_queue (farm_id, event_date, house_id, pen_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, p.house_id, pd.pen_id, 'warn', 'L4-MORT-SPIKE',
         format('폐사 급증 — 당일 %s두, 최근 30일 평균 %s두', pd.dead_head, round(s.avg_d, 1)),
         'pen_daily', pd.id::text
    FROM pen_daily pd JOIN pen p ON p.id = pd.pen_id
    CROSS JOIN LATERAL (
      SELECT avg(x.dead_head) AS avg_d, COALESCE(stddev_pop(x.dead_head), 0) AS sd
        FROM pen_daily x
       WHERE x.pen_id = pd.pen_id
         AND x.report_date BETWEEN p_date - 30 AND p_date - 1) s
   WHERE pd.farm_id = p_farm_id AND pd.report_date = p_date
     AND s.sd > 0 AND pd.dead_head > s.avg_d + c_sigma * s.sd
  ON CONFLICT DO NOTHING;

  -- 두수 급변에 대응 이벤트가 없음
  INSERT INTO exception_queue (farm_id, event_date, house_id, pen_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, p.house_id, pd.pen_id, 'warn', 'L4-SWING',
         format('전일 대비 두수 %s%% 변동 (%s → %s)',
                round(100.0 * (pd.closing_head - pd.opening_head) / NULLIF(pd.opening_head, 0), 1),
                pd.opening_head, pd.closing_head),
         'pen_daily', pd.id::text
    FROM pen_daily pd JOIN pen p ON p.id = pd.pen_id
   WHERE pd.farm_id = p_farm_id AND pd.report_date = p_date
     AND pd.opening_head > 0
     AND abs(pd.closing_head - pd.opening_head)::numeric / pd.opening_head > c_swing
     AND pd.in_head + pd.out_head + pd.internal_out_head
       + pd.sold_head + pd.dead_head + pd.culled_head = 0
  ON CONFLICT DO NOTHING;

  -- 실사 불일치
  INSERT INTO exception_queue (farm_id, event_date, house_id, pen_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, p.house_id, pd.pen_id, 'warn', 'L4-COUNT-VAR',
         format('실사 불일치 %s두 (시스템 %s / 실사 %s) — 사유: %s',
                pd.variance, pd.closing_head, pd.reported_closing_head,
                COALESCE(pd.variance_reason, '미기재')),
         'pen_daily', pd.id::text
    FROM pen_daily pd JOIN pen p ON p.id = pd.pen_id
   WHERE pd.farm_id = p_farm_id AND pd.report_date = p_date
     AND pd.reported_closing_head IS NOT NULL AND pd.variance <> 0
  ON CONFLICT DO NOTHING;

  -- 요일 고정 이동 미이행 (§4.4)
  INSERT INTO exception_queue (farm_id, event_date, house_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, ms.from_house_id, 'warn', 'L4-SCHEDULE',
         format('%s 예정 이동이 등록되지 않았습니다', ms.label),
         'movement_schedule', ms.id::text
    FROM movement_schedule ms
   WHERE ms.farm_id = p_farm_id AND ms.active AND ms.is_movement
     AND ms.weekday = EXTRACT(DOW FROM p_date)::int
     AND NOT EXISTS (
       SELECT 1 FROM movement mv JOIN pen fp ON fp.id = mv.from_pen_id
        WHERE mv.event_date = p_date AND mv.status <> 'cancelled'
          AND fp.house_id = ms.from_house_id)
  ON CONFLICT DO NOTHING;

  -- 장기 무변동 (7일 연속 완전 동일 값)
  INSERT INTO exception_queue (farm_id, event_date, house_id, pen_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, p.house_id, pd.pen_id, 'warn', 'L4-FLAT',
         format('%s일 연속 두수·이벤트 무변동 (%s두)', c_flat_days, pd.closing_head),
         'pen_daily', pd.id::text
    FROM pen_daily pd JOIN pen p ON p.id = pd.pen_id
   WHERE pd.farm_id = p_farm_id AND pd.report_date = p_date AND pd.closing_head > 0
     AND (SELECT count(*) FROM pen_daily x
           WHERE x.pen_id = pd.pen_id
             AND x.report_date BETWEEN p_date - (c_flat_days - 1) AND p_date
             AND x.closing_head = pd.closing_head
             AND x.in_head + x.out_head + x.internal_out_head
               + x.sold_head + x.dead_head + x.culled_head = 0) = c_flat_days
  ON CONFLICT DO NOTHING;

  -- 주차 수태율 하락 (§4.6.1 실측 31주 93.0 / 32주 91.9 / 33주 93.3)
  INSERT INTO exception_queue (farm_id, event_date, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, 'warn', 'L4-CONCEPTION',
         format('%s주차 수태율 %s%% — 기준 90%% 미만', w.week_no, round(100 * w.rate, 2)),
         'breeding', w.week_no::text
    FROM (SELECT b.week_no,
                 count(*) FILTER (WHERE b.outcome = '임신')::numeric
                 / NULLIF(count(*), 0) AS rate
            FROM breeding b
           WHERE b.farm_id = p_farm_id
             AND b.mating_date BETWEEN p_date - 6 AND p_date
             AND b.week_no IS NOT NULL
           GROUP BY b.week_no) w
   WHERE w.rate < c_conception
  ON CONFLICT DO NOTHING;

  -- 조산 (실제 분만일 < 예정일 − 5일)
  INSERT INTO exception_queue (farm_id, event_date, pen_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, f.pen_id, 'info', 'L4-PRETERM',
         format('모돈 %s 조산 — 예정 %s / 실제 %s (%s일 빠름)',
                f.sow_ear_tag, f.expected_farrow_date, f.farrow_date,
                f.expected_farrow_date - f.farrow_date),
         'farrowing', f.id::text
    FROM farrowing f
   WHERE f.farm_id = p_farm_id AND f.farrow_date = p_date
     AND f.expected_farrow_date IS NOT NULL
     AND f.farrow_date < f.expected_farrow_date - c_preterm_days
  ON CONFLICT DO NOTHING;

  -- 재종부 반복 (동일 모돈 3회 이상 → 도태 검토)
  INSERT INTO exception_queue (farm_id, event_date, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, 'warn', 'L4-RESERVICE',
         format('모돈 %s 재종부 %s회 — 도태 검토 대상', s.ear_tag, x.cnt),
         'sow', s.id::text
    FROM sow s
    CROSS JOIN LATERAL (
      SELECT count(*) AS cnt FROM breeding_action ba
        JOIN breeding b ON b.id = ba.breeding_id
       WHERE b.sow_id = s.id AND ba.action_type = '재종부') x
   WHERE s.farm_id = p_farm_id AND x.cnt >= c_reservice
     AND EXISTS (SELECT 1 FROM breeding b2 JOIN breeding_action ba2 ON ba2.breeding_id = b2.id
                  WHERE b2.sow_id = s.id AND ba2.action_date = p_date)
  ON CONFLICT DO NOTHING;

  -- 사산율 급등
  INSERT INTO exception_queue (farm_id, event_date, pen_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, f.pen_id, 'warn', 'L4-STILLBORN',
         format('모돈 %s 사산율 %s%% (사산 %s / 총산 %s)',
                f.sow_ear_tag, round(100.0 * f.stillborn / NULLIF(f.total_born, 0), 1),
                f.stillborn, f.total_born),
         'farrowing', f.id::text
    FROM farrowing f
   WHERE f.farm_id = p_farm_id AND f.farrow_date = p_date AND f.total_born > 0
     AND f.stillborn::numeric / f.total_born > c_stillborn_rate
  ON CONFLICT DO NOTHING;

  -- 이유 복당두수 이탈
  INSERT INTO exception_queue (farm_id, event_date, pen_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, w.pen_id, 'info', 'L4-WEAN',
         format('이유 복당두수 %s두 — 평균 %s 대비 ±30%% 이탈', w.weaned_head, c_wean_avg),
         'weaning', w.id::text
    FROM weaning w
   WHERE w.farm_id = p_farm_id AND w.event_date = p_date
     AND abs(w.weaned_head - c_wean_avg) / c_wean_avg > c_wean_band
  ON CONFLICT DO NOTHING;

  -- 유산 다발 (동일 장소·동일 주차 3건 이상) — 현행 유산분석 시트에 이미 수요가 있다
  INSERT INTO exception_queue (farm_id, event_date, house_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, a.house_id, 'warn', 'L4-ABORTION-CLUSTER',
         format('최근 7일 %s 유산 %s건 — 집중 발생', COALESCE(h.name, '장소 미기재'), count(*)),
         'abortion', a.house_id::text
    FROM abortion a LEFT JOIN house h ON h.id = a.house_id
   WHERE a.farm_id = p_farm_id AND a.abortion_date BETWEEN p_date - 6 AND p_date
   GROUP BY a.house_id, h.name
  HAVING count(*) >= c_abortion_cluster
  ON CONFLICT DO NOTHING;

  -- 사료 재고 대사 이탈 (월말에만 의미가 있다)
  INSERT INTO exception_queue (farm_id, event_date, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, 'warn', 'L4-FEED-STOCK',
         format('%s 재고 차이 %skg (%s%%)', f.name, s.variance,
                round(100 * abs(s.variance) / NULLIF(s.closing_qty_system, 0), 1)),
         'feed_stock_monthly', s.id::text
    FROM feed_stock_monthly s JOIN feed f ON f.id = s.feed_id
   WHERE s.farm_id = p_farm_id
     AND s.year_month = to_char(p_date, 'YYYYMM')
     AND s.closing_qty_field IS NOT NULL
     AND s.closing_qty_system <> 0
     AND abs(s.variance) / abs(s.closing_qty_system) > c_stock_var
  ON CONFLICT DO NOTHING;

  -- 휴약기간 임박 출하
  INSERT INTO exception_queue (farm_id, event_date, house_id, pen_id, severity, rule_code, message, ref_table, ref_pk)
  SELECT p_farm_id, p_date, u.house_id, u.pen_id, 'info', 'L4-WITHDRAW-SOON',
         format('%s 돈방 휴약 종료 %s (%s일 남음)', p.code, u.withdrawal_until,
                u.withdrawal_until - p_date),
         'medicine_usage', u.id::text
    FROM medicine_usage u LEFT JOIN pen p ON p.id = u.pen_id
   WHERE u.farm_id = p_farm_id
     AND u.withdrawal_until BETWEEN p_date AND p_date + c_withdraw_soon
  ON CONFLICT DO NOTHING;

  RETURN (SELECT count(*)::int FROM exception_queue
           WHERE farm_id = p_farm_id AND event_date = p_date AND status = 'open');
END $$;

COMMENT ON FUNCTION app.fn_detect_anomalies IS
  'L4 이상 탐지. 임계값은 §5.6 표 그대로이며 함수 상단 상수로 모아 두었다';

-- ─────────────────────────────────────────────────────────────────────
-- L5 : 마감 게이트 (§5.7)
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.fn_day_close_gate(p_farm_id bigint, p_date date)
RETURNS TABLE (rule_code text, message text)
LANGUAGE plpgsql STABLE AS $$
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
     WHERE m.farm_id = p_farm_id AND m.event_date = p_date AND m.photo_url IS NULL;

  RETURN;
END $$;

-- 마감 시 게이트를 통과하지 못하면 거부하고, 통과하면 전 돈사 일보를 locked 로 바꾼다
CREATE FUNCTION app.fn_day_close_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_cnt int; v_first text;
BEGIN
  SELECT count(*), min(message) INTO v_cnt, v_first
    FROM app.fn_day_close_gate(NEW.farm_id, NEW.close_date);
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'L5: 마감 차단 사유 %건. 첫 건: %', v_cnt, v_first
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  UPDATE daily_report
     SET status = 'locked', locked_at = now()
   WHERE farm_id = NEW.farm_id AND report_date = NEW.close_date AND status = 'confirmed';

  RETURN NEW;
END $$;

CREATE TRIGGER trg_day_close BEFORE INSERT ON day_close
  FOR EACH ROW EXECUTE FUNCTION app.fn_day_close_guard();
