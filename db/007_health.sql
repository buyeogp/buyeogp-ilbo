-- =====================================================================
-- 007 폐사·도태 · 백신 · 약품 — 설계문서 §4.7 / §4.9
-- 조달은 거래명세표로 완전히 추적되나 투여 기록은 존재하지 않는다(C17).
-- 존재하지 않는 기록이므로 시스템이 만들어 낸다 (§4.9.4).
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 폐사 §4.7 (농장 내부 자체 처리) ──────────────────────────────────
CREATE TABLE mortality (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id        bigint NOT NULL REFERENCES farm(id),
  event_date     date   NOT NULL,
  house_id       bigint NOT NULL,
  pen_id         bigint,                   -- NULL = 돈방 구분이 없는 돈사 (종부·임신사)
  batch_id       bigint,
  category_id    bigint REFERENCES pig_category(id),
  head_count     int    NOT NULL CHECK (head_count > 0),
  reason_code_id bigint NOT NULL REFERENCES reason_code(id),
  reason_note    text,
  ear_tag        text,
  sow_id         bigint,
  photo_url      text,                     -- V10 : 필수 (D11 대응)
  photo_due_at   timestamptz,              -- 미첨부 시 24시간 내 보완 기한
  photo_waiver   text,                     -- 부득이한 경우의 사유
  disposal_method text,
  note           text,
  created_by     bigint NOT NULL REFERENCES sec.app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id),
  FOREIGN KEY (pen_id,   farm_id) REFERENCES pen   (id, farm_id),
  FOREIGN KEY (batch_id, farm_id) REFERENCES batch (id, farm_id),
  FOREIGN KEY (sow_id,   farm_id) REFERENCES sow   (id, farm_id),
  -- V10 : 사진이 없으면 사유와 보완 기한이 반드시 있어야 한다
  CONSTRAINT v10_photo_required CHECK (
      photo_url IS NOT NULL
      OR (photo_waiver IS NOT NULL AND photo_due_at IS NOT NULL)
  )
);
COMMENT ON TABLE mortality IS
  '폐사 — 농장 내부에서 자체 처리하는 돼지. 현장 신규 요청으로 도태와 분리 (§4.7)';
COMMENT ON COLUMN mortality.photo_url IS
  '촬영은 하고 있으나(회신 79번) 카톡 전송 시 누락이 잦다(회신 38번).
   사진 없이 폐사 등록을 완료할 수 없다. 부득이한 경우 사유 + 24시간 내 보완 (V10)';

-- ── 도태 §4.7 (농장 외부 식용 처리 가능) ─────────────────────────────
CREATE TABLE culling (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id            bigint NOT NULL REFERENCES farm(id),
  event_date         date   NOT NULL,
  house_id           bigint NOT NULL,
  pen_id             bigint,               -- NULL = 돈방 구분이 없는 돈사
  batch_id           bigint,
  category_id        bigint REFERENCES pig_category(id),
  head_count         int    NOT NULL CHECK (head_count > 0),
  reason_code_id     bigint NOT NULL REFERENCES reason_code(id),
  reason_note        text,
  ear_tag            text,
  sow_id             bigint,
  withdrawal_cleared boolean NOT NULL DEFAULT false,   -- V9 트리거가 채운다
  withdrawal_until   date,                             -- 차단 시 해제 예정일
  destination        text,
  shipment_id        bigint,                           -- 009 에서 FK 연결
  note               text,
  created_by         bigint NOT NULL REFERENCES sec.app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id),
  FOREIGN KEY (pen_id,   farm_id) REFERENCES pen   (id, farm_id),
  FOREIGN KEY (batch_id, farm_id) REFERENCES batch (id, farm_id),
  FOREIGN KEY (sow_id,   farm_id) REFERENCES sow   (id, farm_id)
);

-- ── 백신 접종 기록 (부록 A: 백신 접종 기록부 → vaccination) ──────────
CREATE TABLE vaccination (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id     bigint NOT NULL REFERENCES farm(id),
  event_date  date   NOT NULL,
  house_id    bigint NOT NULL,
  pen_id      bigint,
  batch_id    bigint,
  sow_id      bigint,
  vaccine_id  bigint NOT NULL REFERENCES vaccine(id),
  schedule_id bigint REFERENCES vaccine_schedule(id),  -- 예정 대비 실적
  head_count  int    NOT NULL CHECK (head_count > 0),
  dose        numeric(8,2),
  lot_no      text,
  operator_id bigint REFERENCES sec.app_user(id),
  note        text,
  created_by  bigint NOT NULL REFERENCES sec.app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id),
  FOREIGN KEY (pen_id,   farm_id) REFERENCES pen   (id, farm_id),
  FOREIGN KEY (batch_id, farm_id) REFERENCES batch (id, farm_id),
  FOREIGN KEY (sow_id,   farm_id) REFERENCES sow   (id, farm_id)
);
COMMENT ON TABLE vaccination IS
  '접종 실적. vaccine_schedule 로 산출한 예정일이 지났는데 기록이 없으면 L4 경고 (§4.6.4)';

-- =====================================================================
-- 약품 조달 §4.9.3
--   매주 수요일 오전  팀장이 필요 약품 리스트를 본사에 전달
--   매주 수요일 오후  본사가 취합하여 약품업체에 주문
--         목요일      납품 (거래명세표 수령)
-- =====================================================================

CREATE TABLE medicine_request (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id      bigint NOT NULL REFERENCES farm(id),
  request_date date   NOT NULL,
  house_id     bigint NOT NULL,
  requested_by bigint NOT NULL REFERENCES sec.app_user(id),
  status       request_status NOT NULL DEFAULT '요청',
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (house_id, request_date),
  UNIQUE (id, farm_id),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id)
);
COMMENT ON TABLE medicine_request IS
  '팀장 주간 요청. 현행 요청 리스트는 비정형이므로 옮겨야 할 기존 서식이 없다 —
   시스템 화면이 곧 새 표준 서식이 된다 (R-D / §4.9.3).
   지난주 요청 내역을 기본값으로 불러오면 수량만 조정하면 되므로 입력 1~2분';

CREATE TABLE medicine_request_line (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id  bigint NOT NULL REFERENCES medicine_request(id) ON DELETE CASCADE,
  medicine_id bigint NOT NULL REFERENCES medicine(id),
  qty         numeric(12,2) NOT NULL CHECK (qty > 0),
  note        text,
  UNIQUE (request_id, medicine_id)
);

CREATE TABLE purchase_order (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id     bigint NOT NULL REFERENCES farm(id),
  order_date  date   NOT NULL,
  supplier_id bigint NOT NULL REFERENCES supplier(id),
  kind        order_kind NOT NULL DEFAULT '정기',
  ordered_by  bigint REFERENCES sec.app_user(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, farm_id)
);

-- 설계문서에 주문 라인이 없으나 요청 라인·입고 라인과 대사하려면 필요하므로 신설한다.
CREATE TABLE purchase_order_line (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  medicine_id bigint NOT NULL REFERENCES medicine(id),
  qty         numeric(12,2) NOT NULL CHECK (qty > 0),
  request_line_id bigint REFERENCES medicine_request_line(id),
  UNIQUE (order_id, medicine_id)
);

CREATE TABLE medicine_receipt (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id      bigint NOT NULL REFERENCES farm(id),
  receipt_date date   NOT NULL,
  supplier_id  bigint NOT NULL REFERENCES supplier(id),
  invoice_no   text,
  order_id     bigint REFERENCES purchase_order(id),
  scan_url     text,                        -- 거래명세표 사진
  received_by  bigint REFERENCES sec.app_user(id),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, invoice_no),
  UNIQUE (id, farm_id)
);
COMMENT ON TABLE medicine_receipt IS
  '입고 — 거래명세표 1매 = 1건. 확인된 6매가 전부 목요일(8/6, 8/20, 8/27, 9/3) (§4.9.1)';

CREATE TABLE medicine_receipt_line (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id  bigint NOT NULL REFERENCES medicine_receipt(id) ON DELETE CASCADE,
  medicine_id bigint NOT NULL REFERENCES medicine(id),
  qty         numeric(12,2) NOT NULL CHECK (qty > 0),
  unit_price  numeric(12,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  lot_no      text,
  expiry_date date,
  UNIQUE (receipt_id, medicine_id, lot_no)
);

-- ── 투여 기록 §4.9.5 (신규 — 현행에 존재하지 않는 기록) ──────────────
CREATE TABLE medicine_usage (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id      bigint NOT NULL REFERENCES farm(id),
  event_date   date   NOT NULL,
  house_id     bigint NOT NULL,
  pen_id       bigint,                      -- 1단계 : 돈방 단위
  batch_id     bigint,
  sow_id       bigint,                      -- 2단계 : 개체 단위 (백로그 B1)
  sow_ear_tag  text,
  medicine_id  bigint NOT NULL REFERENCES medicine(id),
  qty          numeric(12,2) NOT NULL CHECK (qty > 0),
  dose         text,
  head_count   int CHECK (head_count IS NULL OR head_count > 0),

  -- 마스터가 바뀌어도 과거 판정이 흔들리지 않도록 투여 시점 값을 고정한다
  withdrawal_days_applied int NOT NULL CHECK (withdrawal_days_applied >= 0),
  withdrawal_until date GENERATED ALWAYS AS
      (event_date + withdrawal_days_applied) STORED,

  operator_id  bigint REFERENCES sec.app_user(id),
  note         text,
  created_by   bigint NOT NULL REFERENCES sec.app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id),
  FOREIGN KEY (pen_id,   farm_id) REFERENCES pen   (id, farm_id),
  FOREIGN KEY (batch_id, farm_id) REFERENCES batch (id, farm_id),
  FOREIGN KEY (sow_id,   farm_id) REFERENCES sow   (id, farm_id),
  CONSTRAINT chk_target_present CHECK (pen_id IS NOT NULL OR sow_id IS NOT NULL)
);
COMMENT ON TABLE medicine_usage IS
  '1단계는 돈방 단위(자1-3방에 덱소론 2병). 과잉 보수적이지만 안전하며 입력은 하루 몇 줄 수준.
   2단계에서 개체 단위로 전환한다 (§4.9.5 / 백로그 B1)';
COMMENT ON COLUMN medicine_usage.withdrawal_until IS
  'V9 판정 기준일. 이 날짜 이전에는 해당 돈방·개체의 출하·도태를 저장 거부한다.
   최장 35일 — (처)안티펜SM (§4.9.2)';

-- ── 재고 대사 §4.9.6 / §4.8 ──────────────────────────────────────────
CREATE TABLE medicine_stock_monthly (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id            bigint NOT NULL REFERENCES farm(id),
  year_month         char(6) NOT NULL CHECK (year_month ~ '^[0-9]{6}$'),
  medicine_id        bigint NOT NULL REFERENCES medicine(id),
  opening_qty        numeric(12,2) NOT NULL DEFAULT 0,
  in_qty             numeric(12,2) NOT NULL DEFAULT 0,   -- medicine_receipt_line 집계
  used_qty           numeric(12,2) NOT NULL DEFAULT 0,   -- medicine_usage 집계
  closing_qty_system numeric(12,2) GENERATED ALWAYS AS
      (opening_qty + in_qty - used_qty) STORED,
  closing_qty_field  numeric(12,2),                      -- 현장 월말 실재고
  variance           numeric(12,2) GENERATED ALWAYS AS
      (opening_qty + in_qty - used_qty - closing_qty_field) STORED,
  variance_reason    text,
  closed_at          timestamptz,
  UNIQUE (farm_id, year_month, medicine_id)
);
COMMENT ON TABLE medicine_stock_monthly IS
  '현행 재고 파일은 8월 사용내역이 전 품목 0 이어서 출납 원장 역할을 못 한다.
   입고는 거래명세표에서, 사용은 투여 기록에서 자동 집계되면 재고가 스스로 맞는다 (§4.9.6)';

-- ── 인덱스 ───────────────────────────────────────────────────────────
CREATE INDEX ON mortality (farm_id, event_date DESC);
CREATE INDEX ON mortality (house_id, event_date DESC);
CREATE INDEX ON mortality (pen_id, event_date DESC);
CREATE INDEX ON mortality (reason_code_id);
CREATE INDEX ON mortality (photo_due_at) WHERE photo_url IS NULL;
CREATE INDEX ON culling (farm_id, event_date DESC);
CREATE INDEX ON culling (house_id, event_date DESC);
CREATE INDEX ON culling (pen_id, event_date DESC);
CREATE INDEX ON vaccination (farm_id, event_date DESC);
CREATE INDEX ON vaccination (batch_id, vaccine_id);
CREATE INDEX ON medicine_request (farm_id, request_date DESC);
CREATE INDEX ON medicine_receipt (farm_id, receipt_date DESC);
CREATE INDEX ON medicine_usage (farm_id, event_date DESC);
CREATE INDEX ON medicine_usage (pen_id, withdrawal_until DESC) WHERE pen_id IS NOT NULL;
CREATE INDEX ON medicine_usage (sow_id, withdrawal_until DESC) WHERE sow_id IS NOT NULL;
CREATE INDEX ON medicine_usage (medicine_id, event_date);
