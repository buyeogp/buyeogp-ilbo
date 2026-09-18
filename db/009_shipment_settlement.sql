-- =====================================================================
-- 009 출하 · 정산 — 설계문서 §4.10
-- 두 가지 수익 구조가 병존한다. v2.1 에서 하나로 뭉뚱그린 것이 오설계였다(C11/C12).
--   ① 자돈 출하 정산 (변동) = (경락가격 × 출하두수 × 36.5) + (30kg 기준 ±2,500원)
--   ② 사육 위탁료 (고정)   = 7,500두 × 월 15,000원 = 112,500,000원 / 월
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 경락가격 §4.10 / Q19 ─────────────────────────────────────────────
CREATE TABLE market_price (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  price_date date   NOT NULL,
  grade      text   NOT NULL DEFAULT '전체',
  price      numeric(12,2) NOT NULL CHECK (price >= 0),
  source     market_price_source NOT NULL DEFAULT 'manual',
  entered_by bigint REFERENCES sec.app_user(id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (price_date, grade)
);
COMMENT ON TABLE market_price IS
  'Q19 미회신. 본사 수동 입력을 기본값으로 구현하고, 축산물품질평가원 자동 수신은
   source 값만 바꾸면 얹을 수 있도록 둔다 (§11.2 / 백로그 B3)';

-- ── 출하 §4.10 ───────────────────────────────────────────────────────
CREATE TABLE shipment (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id         bigint NOT NULL REFERENCES farm(id),
  ship_date       date   NOT NULL,
  channel         shipment_channel NOT NULL,
  batch_id        bigint,
  pen_id          bigint,
  head_count      int    NOT NULL CHECK (head_count > 0),
  total_kg        numeric(12,2) CHECK (total_kg IS NULL OR total_kg > 0),
  avg_weight_kg   numeric(12,4) GENERATED ALWAYS AS
      (CASE WHEN head_count > 0 THEN round(total_kg / head_count, 4) END) STORED,
  unit_price      numeric(12,2),
  amount          numeric(14,2),
  ticket_no       text,                    -- 출하 전표 번호
  scale_ticket_no text,                    -- 계근표 번호
  owner_transfer  boolean NOT NULL DEFAULT false,
  buyer           text,
  note            text,
  created_by      bigint NOT NULL REFERENCES sec.app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, farm_id),
  FOREIGN KEY (batch_id, farm_id) REFERENCES batch (id, farm_id),
  FOREIGN KEY (pen_id,   farm_id) REFERENCES pen   (id, farm_id)
);
COMMENT ON COLUMN shipment.owner_transfer IS
  '소유권 이전. 자돈 75일령, 숫퇘지에 한함 (§4.10)';
COMMENT ON COLUMN shipment.avg_weight_kg IS
  '두당 kg — 생성열. 종합일보 #DIV/0! (두당kg) 의 원인을 구조적으로 제거한다 (D7)';

ALTER TABLE culling
  ADD CONSTRAINT culling_shipment_id_fkey
  FOREIGN KEY (shipment_id) REFERENCES shipment(id);

-- ── 출하 정산 §4.10 ① ────────────────────────────────────────────────
CREATE TABLE settlement_shipment (
  shipment_id         bigint PRIMARY KEY REFERENCES shipment(id) ON DELETE CASCADE,
  farm_id             bigint NOT NULL REFERENCES farm(id),
  settle_date         date   NOT NULL,
  market_price        numeric(12,2) NOT NULL CHECK (market_price >= 0),
  market_price_date   date,
  head_count          int    NOT NULL CHECK (head_count > 0),
  multiplier          numeric(6,2) NOT NULL DEFAULT 36.5,
  weight_adjust_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount        numeric(16,2) GENERATED ALWAYS AS
      (round(market_price * head_count * multiplier, 2) + weight_adjust_amount) STORED,
  actual_amount       numeric(16,2),         -- 실제 정산서 금액
  diff_amount         numeric(16,2) GENERATED ALWAYS AS
      (actual_amount - (round(market_price * head_count * multiplier, 2) + weight_adjust_amount)) STORED,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN settlement_shipment.multiplier IS
  '36.5 는 원 단위가 아니라 경락가격에 곱하는 배수다 (C11 정정 / 9/8 회신)';
COMMENT ON COLUMN settlement_shipment.weight_adjust_amount IS
  '30kg 기준 ±2,500원 조정. 두당인지 총액인지가 회신에 명시되지 않았으므로
   조정 결과 금액을 그대로 보관한다. 정산서 실물 미확보(R-B) →
   첫 정산 시 actual_amount 와 대조하여 산식을 보정한다 (§11.1)';

-- ── 사육 위탁료 §4.10 ② ──────────────────────────────────────────────
CREATE TABLE settlement_monthly (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id       bigint NOT NULL REFERENCES farm(id),
  year_month    char(6) NOT NULL CHECK (year_month ~ '^[0-9]{6}$'),
  capacity_head int    NOT NULL DEFAULT 7500 CHECK (capacity_head > 0),
  unit_price    numeric(12,2) NOT NULL DEFAULT 15000 CHECK (unit_price >= 0),
  total_amount  numeric(16,2) GENERATED ALWAYS AS
      (capacity_head * unit_price) STORED,
  actual_amount numeric(16,2),
  note          text,
  UNIQUE (farm_id, year_month)
);
COMMENT ON TABLE settlement_monthly IS
  '별도로 사육 위탁료가 있다 — 7,500두 × 월 15,000원 = 월 1억 1,250만원 확정매출 (C12 / 9/8 회신)';

-- ── 종돈 분양 판정 §4.10 ─────────────────────────────────────────────
-- 설계문서에 스키마가 없으나 「150일령, 90kg 도달 + 유선·외형·지제 심사」(회신 86번)를
-- 기록해야 하므로 신설한다.
CREATE TABLE breeding_stock_grading (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id           bigint NOT NULL REFERENCES farm(id),
  eval_date         date   NOT NULL,
  batch_id          bigint,
  pen_id            bigint,
  ear_tag           text,
  age_days          int CHECK (age_days IS NULL OR age_days >= 0),
  weight_kg         numeric(6,2),
  udder_pass        boolean,      -- 유선
  conformation_pass boolean,      -- 외형
  leg_pass          boolean,      -- 지제
  result            text CHECK (result IN ('분양','비육도태','보류')),
  shipment_id       bigint REFERENCES shipment(id),
  note              text,
  created_by        bigint REFERENCES sec.app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (batch_id, farm_id) REFERENCES batch (id, farm_id),
  FOREIGN KEY (pen_id,   farm_id) REFERENCES pen   (id, farm_id)
);
COMMENT ON TABLE breeding_stock_grading IS
  '분양 기준 150일령·90kg 도달 + 심사 통과. 시스템은 도달 예정일과 체중 추정치를
   사전 리스트로 제공하고 심사 결과를 기록한다 (§4.10)';

-- ── 인덱스 ───────────────────────────────────────────────────────────
CREATE INDEX ON shipment (farm_id, ship_date DESC);
CREATE INDEX ON shipment (channel, ship_date DESC);
CREATE INDEX ON shipment (batch_id);
CREATE INDEX ON market_price (price_date DESC);
CREATE INDEX ON breeding_stock_grading (farm_id, eval_date DESC);
