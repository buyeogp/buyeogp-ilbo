-- =====================================================================
-- 011 함수 · 트리거 — 설계문서 §5 (5중 방어선)
--
--   L0 필드 검증      → 브라우저 + 컬럼 CHECK (002~010)
--   L1 행 검산        → closing_head / live_born 생성열 (구조적 보장)
--   L2 트랜잭션 검증  → 이 파일의 트리거 (V1~V10)
--   L3 돈사간 대사    → movement status 재계산 + 마감 게이트
--   L4 이상 탐지      → app.fn_detect_anomalies()
--   L5 마감 게이트    → app.fn_day_close_gate()
--
-- 세션 변수
--   app.user_id       현재 사용자 (애플리케이션이 매 커넥션 SET)
--   app.migration     'on' 이면 시간 순서 제약을 우회 (M3 과거 데이터 적재 전용)
--   app.adjustment_id 정정전표 적용 중이면 확정본 수정을 허용 (§5.9)
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ─────────────────────────────────────────────────────────────────────
-- 0. 세션 헬퍼
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.session_user_id() RETURNS bigint
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::bigint $$;

CREATE FUNCTION app.is_migration() RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('app.migration', true), '') = 'on' $$;

CREATE FUNCTION app.is_adjusting() RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT COALESCE(NULLIF(current_setting('app.adjustment_id', true), ''), '') <> '' $$;

CREATE FUNCTION app.is_syncing() RETURNS boolean
LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('app.sync', true), '') = 'on' $$;

-- 일령 / 주차 (§4.2)
CREATE FUNCTION app.age_days(p_birth date, p_on date) RETURNS int
LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN p_birth IS NULL THEN NULL ELSE p_on - p_birth END $$;

CREATE FUNCTION app.age_week(p_birth date, p_on date) RETURNS int
LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN p_birth IS NULL THEN NULL ELSE (p_on - p_birth) / 7 END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 1. 공통 트리거
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.fn_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_touch BEFORE UPDATE ON daily_report
  FOR EACH ROW EXECUTE FUNCTION app.fn_touch_updated_at();
CREATE TRIGGER trg_touch BEFORE UPDATE ON sec.app_user
  FOR EACH ROW EXECUTE FUNCTION app.fn_touch_updated_at();

-- ── 감사로그 §6.6 : 전 업무 테이블 변경 전·후 값 ─────────────────────
CREATE FUNCTION app.fn_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, sec, extensions, public AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
  v_pk     text;
  v_farm   bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_before := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_after  := to_jsonb(NEW); END IF;

  v_pk   := COALESCE(v_after ->> 'id', v_before ->> 'id',
                     v_after ->> 'shipment_id', v_before ->> 'shipment_id');
  v_farm := NULLIF(COALESCE(v_after ->> 'farm_id', v_before ->> 'farm_id'), '')::bigint;

  INSERT INTO sec.audit_log (user_id, action, table_name, pk_value,
                             farm_id, before_data, after_data)
  VALUES (app.session_user_id(), TG_OP::audit_action,
          TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, v_pk,
          v_farm, v_before, v_after);

  RETURN COALESCE(NEW, OLD);
END $$;

-- 감사 대상 테이블에 일괄 부착
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'daily_report','pen_daily','movement','movement_line','batch',
    'breeding','mating_line','breeding_action','abortion','farrowing',
    'sow','boar','parity_record','piglet_transfer','weaning',
    'mortality','culling','vaccination',
    'medicine_usage','medicine_receipt','medicine_receipt_line',
    'medicine_request','medicine_request_line','purchase_order','purchase_order_line',
    'feed_delivery','feed_stock_monthly','medicine_stock_monthly',
    'shipment','settlement_shipment','settlement_monthly','market_price',
    'adjustment','day_close','exception_queue','breeding_stock_grading']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.%I
         FOR EACH ROW EXECUTE FUNCTION app.fn_audit()', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. V5 — 전일 미확정 상태의 익일 입력 차단 (P8)
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.fn_v5_prev_day_confirmed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF app.is_migration() OR NEW.is_baseline THEN RETURN NEW; END IF;

  SELECT report_date, status INTO r
    FROM daily_report
   WHERE house_id = NEW.house_id
     AND report_date < NEW.report_date
   ORDER BY report_date DESC
   LIMIT 1;

  IF FOUND AND r.status NOT IN ('confirmed','locked') THEN
    RAISE EXCEPTION
      'V5: 전일(%) 일보가 아직 확정되지 않았습니다. 상태=% — 오류는 하루를 넘지 못한다(P8)',
      r.report_date, r.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_v5 BEFORE INSERT ON daily_report
  FOR EACH ROW EXECUTE FUNCTION app.fn_v5_prev_day_confirmed();

-- ─────────────────────────────────────────────────────────────────────
-- 3. V2 — 전일두수 자동 이월 · 수정 불가
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.fn_pen_daily_before() RETURNS trigger
LANGUAGE plpgsql AS $$
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

CREATE TRIGGER trg_pen_daily_before BEFORE INSERT OR UPDATE ON pen_daily
  FOR EACH ROW EXECUTE FUNCTION app.fn_pen_daily_before();

-- ─────────────────────────────────────────────────────────────────────
-- 4. V7 — 폐사·도태 두수 = 사유별 합 (원장에서 파생)
-- ─────────────────────────────────────────────────────────────────────
-- 돈방에 돈군이 하나뿐이면 batch_id 를 자동으로 채운다 (회신 113번: 복수 batch 가능)
CREATE FUNCTION app.fn_resolve_batch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_ids bigint[];
BEGIN
  -- 돈방 단위가 아닌 돈사(종부·임신사·계류장)는 돈군을 추정하지 않는다
  IF NEW.batch_id IS NOT NULL OR NEW.pen_id IS NULL THEN RETURN NEW; END IF;

  SELECT array_agg(DISTINCT pd.batch_id) INTO v_ids
    FROM pen_daily pd
   WHERE pd.pen_id = NEW.pen_id
     AND pd.report_date = NEW.event_date
     AND pd.batch_id IS NOT NULL
     AND pd.closing_head + pd.dead_head + pd.culled_head > 0;

  IF v_ids IS NULL THEN
    RETURN NEW;                               -- 일보 행이 아직 없다 — 제출 시 V7 이 잡는다
  ELSIF array_length(v_ids, 1) = 1 THEN
    NEW.batch_id := v_ids[1];
  ELSE
    RAISE EXCEPTION
      '돈방에 돈군이 % 개 있습니다. 어느 돈군인지 선택하십시오', array_length(v_ids, 1)
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_resolve_batch BEFORE INSERT ON mortality
  FOR EACH ROW EXECUTE FUNCTION app.fn_resolve_batch();
CREATE TRIGGER trg_resolve_batch BEFORE INSERT ON culling
  FOR EACH ROW EXECUTE FUNCTION app.fn_resolve_batch();

-- 한 (돈방 × 돈군 × 일자) 의 폐사 또는 도태 두수를 원장에서 다시 세어 일보에 반영한다
CREATE FUNCTION app.fn_recount_pen_daily(
  p_kind text, p_house_id bigint, p_pen_id bigint,
  p_batch_id bigint, p_category_id bigint, p_date date)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_house_id IS NULL OR p_date IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.sync', 'on', true);

  IF p_kind = 'mortality' THEN
    UPDATE pen_daily pd
       SET dead_head = COALESCE((SELECT SUM(m.head_count) FROM mortality m
                                  WHERE m.house_id = p_house_id
                                    AND m.pen_id      IS NOT DISTINCT FROM p_pen_id
                                    AND m.batch_id    IS NOT DISTINCT FROM p_batch_id
                                    AND m.category_id IS NOT DISTINCT FROM p_category_id
                                    AND m.event_date = p_date), 0)
     WHERE pd.house_id = p_house_id
       AND pd.pen_id      IS NOT DISTINCT FROM p_pen_id
       AND pd.batch_id    IS NOT DISTINCT FROM p_batch_id
       AND pd.category_id IS NOT DISTINCT FROM p_category_id
       AND pd.report_date = p_date;
  ELSE
    UPDATE pen_daily pd
       SET culled_head = COALESCE((SELECT SUM(c.head_count) FROM culling c
                                    WHERE c.house_id = p_house_id
                                      AND c.pen_id      IS NOT DISTINCT FROM p_pen_id
                                      AND c.batch_id    IS NOT DISTINCT FROM p_batch_id
                                      AND c.category_id IS NOT DISTINCT FROM p_category_id
                                      AND c.event_date = p_date), 0)
     WHERE pd.house_id = p_house_id
       AND pd.pen_id      IS NOT DISTINCT FROM p_pen_id
       AND pd.batch_id    IS NOT DISTINCT FROM p_batch_id
       AND pd.category_id IS NOT DISTINCT FROM p_category_id
       AND pd.report_date = p_date;
  END IF;

  PERFORM set_config('app.sync', 'off', true);
END $$;

CREATE FUNCTION app.fn_sync_pen_daily_counts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM app.fn_recount_pen_daily(TG_TABLE_NAME, OLD.house_id, OLD.pen_id,
                                     OLD.batch_id, OLD.category_id, OLD.event_date);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM app.fn_recount_pen_daily(TG_TABLE_NAME, NEW.house_id, NEW.pen_id,
                                     NEW.batch_id, NEW.category_id, NEW.event_date);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_sync_counts AFTER INSERT OR UPDATE OR DELETE ON mortality
  FOR EACH ROW EXECUTE FUNCTION app.fn_sync_pen_daily_counts();
CREATE TRIGGER trg_sync_counts AFTER INSERT OR UPDATE OR DELETE ON culling
  FOR EACH ROW EXECUTE FUNCTION app.fn_sync_pen_daily_counts();

-- ─────────────────────────────────────────────────────────────────────
-- 5. V8 / L3 — 이동 1:N 대사
-- ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION app.fn_movement_recalc() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_mid  bigint := COALESCE(NEW.movement_id, OLD.movement_id);
  v_sum  int;
  v_tot  int;
  v_stat movement_status;
BEGIN
  SELECT COALESCE(SUM(head_count), 0) INTO v_sum
    FROM movement_line WHERE movement_id = v_mid;
  SELECT total_head, status INTO v_tot, v_stat
    FROM movement WHERE id = v_mid;

  IF v_stat = 'cancelled' THEN RETURN NULL; END IF;

  -- 수령이 발신을 초과하는 것은 물리적으로 불가능하므로 저장 거부
  IF v_sum > v_tot THEN
    RAISE EXCEPTION 'V8: 수령 합계(%)가 발신 두수(%)를 초과합니다', v_sum, v_tot
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  UPDATE movement
     SET status = CASE WHEN v_sum = 0    THEN 'pending'::movement_status
                       WHEN v_sum = v_tot THEN 'matched'::movement_status
                       ELSE 'disputed'::movement_status END
   WHERE id = v_mid;

  RETURN NULL;
END $$;

CREATE TRIGGER trg_movement_recalc
  AFTER INSERT OR UPDATE OR DELETE ON movement_line
  FOR EACH ROW EXECUTE FUNCTION app.fn_movement_recalc();

-- SoD-5 / SoD-6 : 발신자와 수령자가 같으면 예외큐에 적재한다 (§6.3)
CREATE FUNCTION app.fn_sod5_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m record;
BEGIN
  IF NEW.received_by IS NULL THEN RETURN NULL; END IF;

  SELECT mv.created_by, mv.farm_id, mv.event_date, p.house_id
    INTO m
    FROM movement mv LEFT JOIN pen p ON p.id = mv.from_pen_id
   WHERE mv.id = NEW.movement_id;

  IF m.created_by = NEW.received_by THEN
    INSERT INTO exception_queue
      (farm_id, event_date, house_id, severity, rule_code, message, ref_table, ref_pk)
    VALUES (m.farm_id, m.event_date, m.house_id, 'info', 'SOD-5',
            '이동 발신자와 수령자가 동일합니다. 수령 입력 시 발신 두수를 가린 상태로 계수했는지 확인하십시오 (SoD-6)',
            'movement_line', NEW.id::text)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_sod5 AFTER INSERT OR UPDATE OF received_by ON movement_line
  FOR EACH ROW EXECUTE FUNCTION app.fn_sod5_check();

-- ─────────────────────────────────────────────────────────────────────
-- 6. V9 — 휴약기간
-- ─────────────────────────────────────────────────────────────────────
-- 해당 돈방·개체에 아직 끝나지 않은 휴약기간이 있으면 종료일을 돌려준다
CREATE FUNCTION app.fn_withdrawal_until(
  p_farm_id bigint, p_pen_id bigint, p_batch_id bigint,
  p_sow_id bigint, p_date date)
RETURNS TABLE (until_date date, medicine_name text)
LANGUAGE sql STABLE AS $$
  SELECT u.withdrawal_until, m.name
    FROM medicine_usage u
    JOIN medicine m ON m.id = u.medicine_id
   WHERE u.farm_id = p_farm_id
     AND u.withdrawal_until > p_date
     AND (
          (p_sow_id   IS NOT NULL AND u.sow_id   = p_sow_id)
       OR (p_pen_id   IS NOT NULL AND u.pen_id   = p_pen_id)
       OR (p_batch_id IS NOT NULL AND u.batch_id = p_batch_id)
     )
   ORDER BY u.withdrawal_until DESC
   LIMIT 1;
$$;

CREATE FUNCTION app.fn_medicine_usage_before() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_days int;
BEGIN
  SELECT withdrawal_days INTO v_days FROM medicine WHERE id = NEW.medicine_id;
  IF v_days IS NULL THEN
    RAISE EXCEPTION '약품 마스터를 찾을 수 없습니다 (medicine_id=%)', NEW.medicine_id;
  END IF;
  -- 투여 시점 값을 고정 보관한다 (마스터 변경이 과거 판정을 흔들지 않도록)
  IF TG_OP = 'INSERT' THEN NEW.withdrawal_days_applied := v_days; END IF;

  IF NEW.sow_id IS NOT NULL AND NEW.sow_ear_tag IS NULL THEN
    SELECT ear_tag INTO NEW.sow_ear_tag FROM sow WHERE id = NEW.sow_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_medicine_usage_before BEFORE INSERT OR UPDATE ON medicine_usage
  FOR EACH ROW EXECUTE FUNCTION app.fn_medicine_usage_before();

-- shipment 과 culling 은 컬럼 구성이 다르므로 jsonb 로 공통 추출한다
CREATE FUNCTION app.fn_v9_withdrawal_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  w       record;
  v_row   jsonb  := to_jsonb(NEW);
  v_date  date   := COALESCE((v_row ->> 'ship_date')::date, (v_row ->> 'event_date')::date);
  v_pen   bigint := NULLIF(v_row ->> 'pen_id',   '')::bigint;
  v_house bigint := NULLIF(v_row ->> 'house_id', '')::bigint;
  v_batch bigint := NULLIF(v_row ->> 'batch_id', '')::bigint;
  v_sow   bigint := NULLIF(v_row ->> 'sow_id',   '')::bigint;
  v_farm  bigint := (v_row ->> 'farm_id')::bigint;
BEGIN
  IF app.is_migration() THEN RETURN NEW; END IF;

  -- 돈방이 지정되지 않은 배치 단위 출하는 그 날 해당 돈군이 있던 돈방 전체를 본다
  IF v_pen IS NULL AND v_batch IS NOT NULL THEN
    SELECT u.withdrawal_until AS until_date, m.name AS medicine_name INTO w
      FROM medicine_usage u
      JOIN medicine m ON m.id = u.medicine_id
     WHERE u.farm_id = v_farm
       AND u.withdrawal_until > v_date
       AND (u.batch_id = v_batch
            OR u.pen_id IN (SELECT pd.pen_id FROM pen_daily pd
                             WHERE pd.batch_id = v_batch AND pd.report_date = v_date))
     ORDER BY u.withdrawal_until DESC
     LIMIT 1;
  ELSIF v_pen IS NULL AND v_batch IS NULL AND v_sow IS NULL AND v_house IS NOT NULL THEN
    -- 돈방 구분이 없는 돈사(종부/임신사)는 돈사 단위 투여 기록을 본다
    SELECT u.withdrawal_until AS until_date, m.name AS medicine_name INTO w
      FROM medicine_usage u
      JOIN medicine m ON m.id = u.medicine_id
     WHERE u.farm_id = v_farm AND u.house_id = v_house
       AND u.withdrawal_until > v_date
     ORDER BY u.withdrawal_until DESC
     LIMIT 1;
  ELSE
    SELECT * INTO w FROM app.fn_withdrawal_until(v_farm, v_pen, v_batch, v_sow, v_date);
  END IF;

  IF FOUND AND w.until_date IS NOT NULL THEN
    RAISE EXCEPTION
      'V9: 휴약기간 미경과 — % 투여분의 휴약 종료일이 % 입니다 (출하·도태 불가)',
      w.medicine_name, w.until_date
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF TG_TABLE_NAME = 'culling' THEN
    NEW.withdrawal_cleared := true;
    NEW.withdrawal_until   := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_v9 BEFORE INSERT OR UPDATE ON shipment
  FOR EACH ROW EXECUTE FUNCTION app.fn_v9_withdrawal_guard();
CREATE TRIGGER trg_v9 BEFORE INSERT OR UPDATE ON culling
  FOR EACH ROW EXECUTE FUNCTION app.fn_v9_withdrawal_guard();

-- ─────────────────────────────────────────────────────────────────────
-- 7. 번식 보조 트리거
-- ─────────────────────────────────────────────────────────────────────
-- 미등록 이각번호는 신규 개체로 자동 생성한다 (§4.6.3 운영 중 축적)
CREATE FUNCTION app.fn_ensure_sow(p_farm_id bigint, p_ear_tag text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  SELECT id INTO v_id FROM sow WHERE farm_id = p_farm_id AND ear_tag = p_ear_tag;
  IF v_id IS NULL THEN
    INSERT INTO sow (farm_id, ear_tag, source) VALUES (p_farm_id, p_ear_tag, 'auto')
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION app.fn_ensure_boar(p_farm_id bigint, p_ear_tag text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  IF p_ear_tag IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM boar WHERE farm_id = p_farm_id AND ear_tag = p_ear_tag;
  IF v_id IS NULL THEN
    INSERT INTO boar (farm_id, ear_tag, source) VALUES (p_farm_id, p_ear_tag, 'auto')
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END $$;

-- 오타와 신규를 구분하기 위한 유사 번호 제시 (한 자리 차이) — §4.6.3
CREATE FUNCTION app.fn_similar_ear_tags(p_farm_id bigint, p_ear_tag text)
RETURNS TABLE (ear_tag text, status sow_status)
LANGUAGE sql STABLE AS $$
  SELECT s.ear_tag, s.status
    FROM sow s
   WHERE s.farm_id = p_farm_id
     AND s.ear_tag <> p_ear_tag
     AND length(s.ear_tag) = length(p_ear_tag)
     AND (SELECT count(*) FROM generate_series(1, length(p_ear_tag)) AS i
           WHERE substr(s.ear_tag, i, 1) <> substr(p_ear_tag, i, 1)) = 1
   ORDER BY s.ear_tag
   LIMIT 5;
$$;
COMMENT ON FUNCTION app.fn_similar_ear_tags IS
  '미등록 번호 입력 시 한 자리만 다른 기존 번호를 함께 제시한다.
   2129 를 2139 로 잘못 친 경우를 이 지점에서 잡는다 (§4.6.3)';

CREATE FUNCTION app.fn_breeding_before() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sow_id IS NULL THEN
    NEW.sow_id := app.fn_ensure_sow(NEW.farm_id, NEW.sow_ear_tag);
  ELSIF NEW.sow_ear_tag IS NULL THEN
    SELECT ear_tag INTO NEW.sow_ear_tag FROM sow WHERE id = NEW.sow_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_breeding_before BEFORE INSERT OR UPDATE ON breeding
  FOR EACH ROW EXECUTE FUNCTION app.fn_breeding_before();

CREATE FUNCTION app.fn_farrowing_before() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sow_id IS NULL THEN
    NEW.sow_id := app.fn_ensure_sow(NEW.farm_id, NEW.sow_ear_tag);
  ELSIF NEW.sow_ear_tag IS NULL THEN
    SELECT ear_tag INTO NEW.sow_ear_tag FROM sow WHERE id = NEW.sow_id;
  END IF;

  -- 종부대장 ↔ 분만대장 연결 : 개체 + 분만예정일이 가장 가까운 교배 건
  IF NEW.breeding_id IS NULL THEN
    SELECT b.id, b.expected_farrow_date
      INTO NEW.breeding_id, NEW.expected_farrow_date
      FROM breeding b
     WHERE b.sow_id = NEW.sow_id
       AND b.mating_date BETWEEN NEW.farrow_date - 130 AND NEW.farrow_date - 100
     ORDER BY abs(b.expected_farrow_date - NEW.farrow_date)
     LIMIT 1;
  ELSIF NEW.expected_farrow_date IS NULL THEN
    SELECT expected_farrow_date INTO NEW.expected_farrow_date
      FROM breeding WHERE id = NEW.breeding_id;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_farrowing_before BEFORE INSERT OR UPDATE ON farrowing
  FOR EACH ROW EXECUTE FUNCTION app.fn_farrowing_before();

CREATE FUNCTION app.fn_mating_line_before() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT farm_id INTO NEW.farm_id FROM breeding WHERE id = NEW.breeding_id;
  IF NEW.boar_id IS NULL AND NEW.boar_ear_tag IS NOT NULL THEN
    NEW.boar_id := app.fn_ensure_boar(NEW.farm_id, NEW.boar_ear_tag);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_mating_line_before BEFORE INSERT OR UPDATE ON mating_line
  FOR EACH ROW EXECUTE FUNCTION app.fn_mating_line_before();

CREATE FUNCTION app.fn_abortion_before() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT farm_id, mating_date INTO NEW.farm_id, NEW.mating_date
    FROM breeding WHERE id = NEW.breeding_id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_abortion_before BEFORE INSERT ON abortion
  FOR EACH ROW EXECUTE FUNCTION app.fn_abortion_before();

-- 유산 등록 시 교배 건의 결과를 함께 갱신한다
CREATE FUNCTION app.fn_abortion_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE breeding
     SET outcome = '유산', outcome_date = NEW.abortion_date
   WHERE id = NEW.breeding_id AND outcome <> '유산';
  RETURN NULL;
END $$;

CREATE TRIGGER trg_abortion_after AFTER INSERT ON abortion
  FOR EACH ROW EXECUTE FUNCTION app.fn_abortion_after();
