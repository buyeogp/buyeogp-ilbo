-- =====================================================================
-- 008 사료 — 설계문서 §4.8
-- 급이량은 기록하지 않지만(회신 88번) 돈사별 사료통 투입 기록이 재고관리 파일에
-- 존재한다. 이것이 사실상 급이량 원장이다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

CREATE TABLE feed_delivery (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id     bigint NOT NULL REFERENCES farm(id),
  event_date  date   NOT NULL,
  house_id    bigint NOT NULL,
  feed_id     bigint NOT NULL REFERENCES feed(id),
  qty_kg      numeric(12,2) NOT NULL CHECK (qty_kg > 0),
  unit_price  numeric(12,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  amount      numeric(14,2) GENERATED ALWAYS AS
      (round(qty_kg * COALESCE(unit_price, 0), 2)) STORED,
  supplier_id bigint REFERENCES supplier(id),
  note        text,
  created_by  bigint REFERENCES sec.app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (house_id, feed_id, event_date),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id)
);
COMMENT ON TABLE feed_delivery IS
  '사료 투입 (돈사 × 품목 × 일자 × kg). 현행 재고관리(사료) 파일의 일자별 1~31일 열에 대응.
   돈사별 투입량과 돈군별 두수·증체를 결합하면 FCR 이 추가 입력 없이 산출된다 (§4.8)';
COMMENT ON COLUMN feed_delivery.unit_price IS
  '투입 시점 단가. feed_price_history 에서 조회해 채운다 (인상 이력 대응)';

CREATE TABLE feed_stock_monthly (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id            bigint NOT NULL REFERENCES farm(id),
  year_month         char(6) NOT NULL CHECK (year_month ~ '^[0-9]{6}$'),
  feed_id            bigint NOT NULL REFERENCES feed(id),
  opening_qty        numeric(14,2) NOT NULL DEFAULT 0,
  in_qty             numeric(14,2) NOT NULL DEFAULT 0,   -- 주문·입고
  used_qty           numeric(14,2) NOT NULL DEFAULT 0,   -- feed_delivery 집계
  closing_qty_system numeric(14,2) GENERATED ALWAYS AS
      (opening_qty + in_qty - used_qty) STORED,
  closing_qty_field  numeric(14,2),                      -- 현장 월말 실재고
  variance           numeric(14,2) GENERATED ALWAYS AS
      (opening_qty + in_qty - used_qty - closing_qty_field) STORED,
  variance_reason    text,
  closed_at          timestamptz,
  UNIQUE (farm_id, year_month, feed_id)
);
COMMENT ON TABLE feed_stock_monthly IS
  '현행 파일이 이미 「서울사무실 기준 남은 재고」와 「현장 월말 실재고」를 나란히 대조하고 있으며
   8월 기준 차이 −1,490kg 이 기록되어 있다. 이 대조를 시스템 기능으로 승격 (§4.8).
   L4 : 차이 > 3% 시 경고';

CREATE INDEX ON feed_delivery (farm_id, event_date DESC);
CREATE INDEX ON feed_delivery (house_id, event_date DESC);
CREATE INDEX ON feed_delivery (feed_id, event_date);
