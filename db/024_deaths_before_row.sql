-- =====================================================================
-- 024 폐사·도태를 일보 행보다 먼저 등록한 경우 (V7)
--
-- 폐사 등록 화면이 생기면서 드러났다. 팀장이 숫자를 넣기 전에(= 그 줄이 저장되기 전에)
-- 폐사부터 등록하면, 원장 → 일보 재계산 트리거는 **있는 행만** 고치므로 대상이 없다.
-- 나중에 줄이 저장될 때 dead_head 가 0 으로 들어가 제출 때 「폐사 두수 불일치」로 막혔다.
-- 행이 만들어질 때 원장 합계를 가지고 태어나게 한다.
--
-- 둘째: 사진 보완처럼 두수와 무관한 원장 수정도 재계산 트리거가 일보 행을 UPDATE 해서
-- 확정된 일보면 P4(확정 후 불변)에 걸렸다. 두수가 실제로 바뀔 때만 고친다.
-- 011 도 같은 본문으로 고쳤다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

CREATE OR REPLACE FUNCTION app.fn_pen_daily_before() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, sec, extensions, public AS $$
DECLARE
  v_rep    record;
  v_prev   int;
BEGIN
  SELECT dr.farm_id, dr.house_id, dr.report_date, dr.status, dr.is_baseline
    INTO v_rep
    FROM daily_report dr WHERE dr.id = NEW.report_id;

  NEW.farm_id     := v_rep.farm_id;
  NEW.house_id    := v_rep.house_id;
  NEW.report_date := v_rep.report_date;

  IF TG_OP = 'INSERT' THEN
    -- V2 : opening = 직전 확정본의 closing
    -- 행 식별 키는 (돈사, 돈방, 돈군, 축종구분). 돈방이 없는 돈사(종부·임신사)는
    -- 돈방·돈군이 NULL 이고 축종구분으로만 이어진다.
    IF NOT v_rep.is_baseline AND NOT app.is_migration() THEN
      SELECT pd.closing_head INTO v_prev
        FROM pen_daily pd
        JOIN daily_report d2 ON d2.id = pd.report_id
       WHERE pd.house_id    = v_rep.house_id
         AND pd.pen_id      IS NOT DISTINCT FROM NEW.pen_id
         AND pd.batch_id    IS NOT DISTINCT FROM NEW.batch_id
         AND pd.category_id IS NOT DISTINCT FROM NEW.category_id
         AND pd.report_date < v_rep.report_date
         AND d2.status IN ('confirmed','locked')
       ORDER BY pd.report_date DESC
       LIMIT 1;

      NEW.opening_head := COALESCE(v_prev, 0);

      -- V7 : 폐사·도태를 일보 행보다 먼저 등록했으면 그 두수를 가지고 태어난다.
      -- 원장이 바뀔 때 다시 세는 트리거(fn_recount_pen_daily)는 있는 행만 고치므로,
      -- 여기서 안 세면 늦게 저장된 행은 0 으로 남아 제출 때 「폐사 두수 불일치」가 된다
      NEW.dead_head := COALESCE((SELECT SUM(m.head_count) FROM mortality m
                                  WHERE m.house_id = v_rep.house_id
                                    AND m.pen_id      IS NOT DISTINCT FROM NEW.pen_id
                                    AND m.batch_id    IS NOT DISTINCT FROM NEW.batch_id
                                    AND m.category_id IS NOT DISTINCT FROM NEW.category_id
                                    AND m.event_date = v_rep.report_date), 0);
      NEW.culled_head := COALESCE((SELECT SUM(c.head_count) FROM culling c
                                    WHERE c.house_id = v_rep.house_id
                                      AND c.pen_id      IS NOT DISTINCT FROM NEW.pen_id
                                      AND c.batch_id    IS NOT DISTINCT FROM NEW.batch_id
                                      AND c.category_id IS NOT DISTINCT FROM NEW.category_id
                                      AND c.event_date = v_rep.report_date), 0);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- P4 : 확정 이후 원본 불변. 정정전표 적용 중에만 예외
    IF v_rep.status IN ('confirmed','locked')
       AND NOT app.is_adjusting() AND NOT app.is_migration() THEN
      RAISE EXCEPTION
        'P4: 확정된 일보(%)는 직접 수정할 수 없습니다. 정정전표를 발행하십시오',
        v_rep.report_date
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    IF NEW.opening_head <> OLD.opening_head
       AND NOT app.is_adjusting() AND NOT app.is_migration() THEN
      RAISE EXCEPTION 'V2: 전일두수는 시스템이 채우며 수정할 수 없습니다'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    -- 폐사·도태 두수는 원장(mortality/culling)에서 파생된다
    IF (NEW.dead_head <> OLD.dead_head OR NEW.culled_head <> OLD.culled_head)
       AND NOT app.is_syncing() AND NOT app.is_migration() THEN
      RAISE EXCEPTION
        'V7: 폐사·도태 두수는 폐사/도태 등록 화면에서 입력하십시오 (두수는 사유별 합의 파생값)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.fn_recount_pen_daily(
  p_kind text, p_house_id bigint, p_pen_id bigint,
  p_batch_id bigint, p_category_id bigint, p_date date)
RETURNS void LANGUAGE plpgsql
SET search_path = app, sec, extensions, public AS $$
DECLARE v_sum int;
BEGIN
  IF p_house_id IS NULL OR p_date IS NULL THEN RETURN; END IF;

  IF p_kind = 'mortality' THEN
    SELECT COALESCE(SUM(m.head_count), 0) INTO v_sum FROM mortality m
     WHERE m.house_id = p_house_id
       AND m.pen_id      IS NOT DISTINCT FROM p_pen_id
       AND m.batch_id    IS NOT DISTINCT FROM p_batch_id
       AND m.category_id IS NOT DISTINCT FROM p_category_id
       AND m.event_date = p_date;
  ELSE
    SELECT COALESCE(SUM(c.head_count), 0) INTO v_sum FROM culling c
     WHERE c.house_id = p_house_id
       AND c.pen_id      IS NOT DISTINCT FROM p_pen_id
       AND c.batch_id    IS NOT DISTINCT FROM p_batch_id
       AND c.category_id IS NOT DISTINCT FROM p_category_id
       AND c.event_date = p_date;
  END IF;

  -- 두수가 **실제로 바뀔 때만** 일보 행을 고친다. 사진 보완처럼 두수와 무관한 수정이
  -- 확정된 일보 행을 건드려 P4(확정 후 불변)에 걸리던 것을 막는다
  PERFORM set_config('app.sync', 'on', true);
  IF p_kind = 'mortality' THEN
    UPDATE pen_daily pd SET dead_head = v_sum
     WHERE pd.house_id = p_house_id
       AND pd.pen_id      IS NOT DISTINCT FROM p_pen_id
       AND pd.batch_id    IS NOT DISTINCT FROM p_batch_id
       AND pd.category_id IS NOT DISTINCT FROM p_category_id
       AND pd.report_date = p_date
       AND pd.dead_head <> v_sum;
  ELSE
    UPDATE pen_daily pd SET culled_head = v_sum
     WHERE pd.house_id = p_house_id
       AND pd.pen_id      IS NOT DISTINCT FROM p_pen_id
       AND pd.batch_id    IS NOT DISTINCT FROM p_batch_id
       AND pd.category_id IS NOT DISTINCT FROM p_category_id
       AND pd.report_date = p_date
       AND pd.culled_head <> v_sum;
  END IF;
  PERFORM set_config('app.sync', 'off', true);
END $$;

