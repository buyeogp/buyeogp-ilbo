-- =====================================================================
-- 005 이동 원장 — 설계문서 §4.3 / §4.4 / §4.5 / §5.5
-- 보낸 방 하나 : 받는 방 여러 곳 (1:N). 이동 1건 = 양방 반영으로
-- 대사 불일치가 구조적으로 소멸한다 (§3.2).
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 이동 헤더 (발신 단위) §4.3 ───────────────────────────────────────
CREATE TABLE movement (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id        bigint NOT NULL REFERENCES farm(id),
  event_date     date   NOT NULL,
  from_pen_id    bigint,                    -- NULL = 외부 입식
  from_batch_id  bigint,
  to_house_id    bigint,                    -- 목적지 돈사. NULL = 외부 출하
  total_head     int    NOT NULL CHECK (total_head > 0),
  avg_weight_kg  numeric(6,2) CHECK (avg_weight_kg IS NULL OR avg_weight_kg > 0),
  move_type      move_type NOT NULL,
  status         movement_status NOT NULL DEFAULT 'pending',
  schedule_id    bigint,                    -- 예정 이동과의 대조 (§4.4)
  reason_code_id bigint REFERENCES reason_code(id),
  note           text,
  created_by     bigint NOT NULL REFERENCES sec.app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_by   bigint REFERENCES sec.app_user(id),
  cancelled_at   timestamptz,
  UNIQUE (id, farm_id),
  FOREIGN KEY (from_pen_id,   farm_id) REFERENCES pen   (id, farm_id),
  FOREIGN KEY (from_batch_id, farm_id) REFERENCES batch (id, farm_id),
  FOREIGN KEY (to_house_id,   farm_id) REFERENCES house (id, farm_id),
  CONSTRAINT chk_cancel CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
COMMENT ON COLUMN movement.to_house_id IS
  '발신 시점에 목적지 돈사를 지정한다. 수령 돈방 배분(movement_line)이 아직 없어도
   수신 측 「수령 대기함」 배지를 띄울 수 있어야 하기 때문 (§5.5 [3] / §8.1)';
COMMENT ON TABLE movement IS
  '이동 헤더. 8/18 육성사 실제 사례 — 2-4방 203두 + 2-6방 197두 = 400두 발신 → 검정사 5-1~5-4 수령 (§4.3)';
COMMENT ON COLUMN movement.move_type IS
  '돈사간전출 = 파트동 경계를 넘는 이동(전출) / 내부이동 = 파트동 안 돈방 간 이동(내부전출) (§4.5, 회신 62번).
   되돌림 = 분만 후 이유모돈 → 순치사 (회신 68번)';

-- ── 수령 분할 (1:N) §4.3 ─────────────────────────────────────────────
CREATE TABLE movement_line (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  movement_id  bigint NOT NULL,
  farm_id      bigint NOT NULL,
  to_pen_id    bigint,                      -- NULL = 외부 출하
  to_batch_id  bigint,
  head_count   int    NOT NULL CHECK (head_count > 0),
  received_by  bigint REFERENCES sec.app_user(id),
  received_at  timestamptz,
  note         text,
  FOREIGN KEY (movement_id, farm_id) REFERENCES movement (id, farm_id) ON DELETE CASCADE,
  FOREIGN KEY (to_pen_id,   farm_id) REFERENCES pen      (id, farm_id),
  FOREIGN KEY (to_batch_id, farm_id) REFERENCES batch    (id, farm_id),
  UNIQUE NULLS NOT DISTINCT (movement_id, to_pen_id, to_batch_id)
);
COMMENT ON TABLE movement_line IS
  'V8 : SUM(head_count) = movement.total_head. 불일치 시 movement.status = disputed (§5.4)';

-- SoD-5 / SoD-6 : 발신자와 수령자는 서로 다른 팀장이어야 한다.
-- 육성→비육/검정처럼 한 팀장이 양쪽을 맡는 구간은 예외이므로 CHECK 로 강제하지 않고,
-- 011 의 트리거에서 예외큐에 적재한다.

-- ── 요일 고정 이동 스케줄 §4.4 ───────────────────────────────────────
CREATE TABLE movement_schedule (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id       bigint NOT NULL REFERENCES farm(id),
  weekday       int    NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0=일요일
  from_house_id bigint,
  to_house_id   bigint,
  move_type     move_type NOT NULL,
  label         text NOT NULL,
  is_movement   boolean NOT NULL DEFAULT true,   -- false = '수요일 이유 두수 파악' 같은 비이동 작업
  active        boolean NOT NULL DEFAULT true,
  FOREIGN KEY (from_house_id, farm_id) REFERENCES house (id, farm_id),
  FOREIGN KEY (to_house_id,   farm_id) REFERENCES house (id, farm_id)
);
COMMENT ON TABLE movement_schedule IS
  '요일 고정 이동 (회신 65번). 해당 요일에 예정 이동이 등록되지 않으면 마감 시 경고 — 이동 누락 검출 (§4.4 / L4)';

ALTER TABLE movement
  ADD CONSTRAINT movement_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES movement_schedule(id);

-- ── 인덱스 ───────────────────────────────────────────────────────────
CREATE INDEX ON movement (farm_id, event_date DESC);
CREATE INDEX ON movement (from_pen_id, event_date DESC);
CREATE INDEX ON movement (status) WHERE status IN ('pending','disputed');
CREATE INDEX ON movement (to_house_id, event_date) WHERE status = 'pending';
CREATE INDEX ON movement_line (movement_id);
CREATE INDEX ON movement_line (to_pen_id);
CREATE INDEX ON movement_schedule (farm_id, weekday) WHERE active;
