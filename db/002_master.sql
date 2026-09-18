-- =====================================================================
-- 002 마스터 — 설계문서 §4.1
-- 테넌트 축: farm. house/pen 이하 전 업무 테이블이 farm_id 를 들고 다니며
--            복합 FK (id, farm_id) 로 교차 테넌트 혼입을 구조적으로 차단한다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 농장 ─────────────────────────────────────────────────────────────
CREATE TABLE farm (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  biz_no      text,
  haccp_no    text,
  address     text,
  close_time  time NOT NULL DEFAULT '18:30',   -- §6.4 마감 18:30
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE  farm IS '농장 — 멀티테넌시 루트 (§7.2, 회신 102번 다농장 확장 계획)';
COMMENT ON COLUMN farm.close_time IS '일 마감 시각. 18:00 미제출 알림, 18:30 마감 (§6.4)';

-- ── 소유주체 ─────────────────────────────────────────────────────────
CREATE TABLE owner (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  is_consign boolean NOT NULL DEFAULT false,   -- 중앙축산 위탁 여부
  active     boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE owner IS '소유주체 — 부여GP / 중앙축산(위탁) (§4.1)';

-- ── 축종구분 ─────────────────────────────────────────────────────────
CREATE TABLE pig_category (
  id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code   text NOT NULL UNIQUE,
  name   text NOT NULL,
  seq    int  NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE pig_category IS
  '축종구분 — 후보(수)/후보(암)/웅돈/이유모돈/체류돈/임신돈/포유모돈/포유자돈/자돈/육성/검정/비육 (§4.1)';

-- ── 돈사 ─────────────────────────────────────────────────────────────
CREATE TABLE house (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id    bigint NOT NULL REFERENCES farm(id),
  code       text   NOT NULL,
  name       text   NOT NULL,
  type       house_type NOT NULL,
  count_basis count_basis NOT NULL DEFAULT 'pen',
  seq        int    NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, code),
  UNIQUE (id, farm_id)                       -- 복합 FK 대상
);
COMMENT ON COLUMN house.seq IS
  '일보·화면 표시 순서. 돼지 이동 순서(순치→종부→임신→분만→자돈→육성→비육/검정)를 따른다.
   단 검정사와 비육사 순서는 현행과 교체 (§3.3, 회신 44번)';

-- ── 돈방 ─────────────────────────────────────────────────────────────
CREATE TABLE pen (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id     bigint NOT NULL,
  house_id    bigint NOT NULL,
  code        text   NOT NULL,
  capacity    int    CHECK (capacity IS NULL OR capacity > 0),
  sex_hint    sex_mix,
  seq         int    NOT NULL DEFAULT 0,
  active_from date   NOT NULL DEFAULT current_date,
  active_to   date,
  UNIQUE (house_id, code),
  UNIQUE (id, farm_id),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id),
  CHECK (active_to IS NULL OR active_to >= active_from)
);
COMMENT ON TABLE pen IS
  '돈방 — 약 110개. 회신 57번: 신설·폐쇄 없음. active_from/to 는 예외 대비 (§3.2)';

-- ── 돈사별 일보 행 정의 ──────────────────────────────────────────────
-- count_basis 가 category / pen_category 인 돈사가 어떤 축종구분을 집계하는지.
-- 현행 일보의 행 구성을 그대로 데이터로 옮긴 것이며, 일보 제출 시
-- 「모든 행이 입력되었는가」(L1-COMPLETE) 판정의 기준이 된다.
CREATE TABLE house_category (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id     bigint NOT NULL,
  house_id    bigint NOT NULL,
  category_id bigint NOT NULL REFERENCES pig_category(id),
  seq         int    NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (house_id, category_id),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id)
);
COMMENT ON TABLE house_category IS
  '예) 순치사 = 후보(수)·후보(암)·이유모돈·체류돈·임신돈 5행,
        종부사 = 웅돈·후보(암)·이유돈·단기체류·장기체류·임신돈 6행,
        분만1동 = 돈방 11개 × 분만대기돈·포유모돈·포유자돈·이유자돈 4행';

-- ── 사유코드 §4.7 ────────────────────────────────────────────────────
CREATE TABLE reason_code (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  scope        text NOT NULL CHECK (scope IN ('mortality','culling','both')),
  needs_note   boolean NOT NULL DEFAULT false,  -- '06 기타' 선택 시 사유 텍스트 필수
  seq          int NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE reason_code IS
  '폐사·도태 사유코드 — 01 위축 / 02 표피염 / 03 압사 / 04 아사 / 05 도태 / 06 기타 (§4.7 신규 제정)';

-- ── 업체 ─────────────────────────────────────────────────────────────
CREATE TABLE supplier (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name     text NOT NULL,
  biz_no   text,
  kind     text CHECK (kind IN ('약품','사료','기타')),
  phone    text,
  address  text,
  active   boolean NOT NULL DEFAULT true,
  UNIQUE (name, kind)
);
COMMENT ON TABLE supplier IS
  '업체 — (주)AG동물약품 710-87-00281(일반 약품), 축협(구제역 백신 전용) (§4.9.1)';

-- ── 백신 마스터 ──────────────────────────────────────────────────────
CREATE TABLE vaccine (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  maker       text,
  disease     text,                    -- 대상 질병 (구제역, 콜레라, 파보 …)
  is_national boolean NOT NULL DEFAULT false,  -- 국가 관리 백신(구제역) → 축협 공급
  dose_unit   text,
  supplier_id bigint REFERENCES supplier(id),
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (name, maker)
);

-- ── 표준 접종 계획 §4.6.4 ────────────────────────────────────────────
CREATE TABLE vaccine_schedule (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id      bigint REFERENCES farm(id),     -- NULL = 전 농장 공통
  target       vaccine_target NOT NULL,
  basis        vaccine_basis  NOT NULL,
  offset_value int NOT NULL,                   -- 157(일령), 8(주차), -6(분만 6주 전)
  fixed_month  int CHECK (fixed_month BETWEEN 1 AND 12),   -- basis='연간고정'
  fixed_week   int CHECK (fixed_week  BETWEEN 1 AND 5),
  vaccine_id   bigint NOT NULL REFERENCES vaccine(id),
  is_optional  boolean NOT NULL DEFAULT false, -- '필요시' 항목
  note         text,
  active       boolean NOT NULL DEFAULT true,
  CHECK ( (basis = '연간고정') = (fixed_month IS NOT NULL) )
);
COMMENT ON TABLE vaccine_schedule IS
  '2025년판 백신 프로그램. 돈군 birth_date_avg 또는 모돈 분만예정일로부터 접종 예정일을 자동 산출한다 (§4.6.4)';

-- ── 약품 마스터 §4.9.2 (원천: AG동물약품 거래명세표) ─────────────────
CREATE TABLE medicine (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,
  maker           text,
  is_prescription boolean NOT NULL DEFAULT false,  -- 품목명 앞 '(처)' 표시
  withdrawal_days int  NOT NULL DEFAULT 0 CHECK (withdrawal_days >= 0),
  category        medicine_category NOT NULL DEFAULT '기타',
  form            medicine_form,
  spec            text,                            -- '20g', '100ml', '50ml'
  unit            text NOT NULL DEFAULT 'EA',
  unit_price      numeric(12,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  expiry_date     date,
  supplier_id     bigint REFERENCES supplier(id),
  active          boolean NOT NULL DEFAULT true,
  -- spec 이 NULL 인 품목이 있으므로 NULL 을 같은 값으로 취급해야 중복이 막힌다
  UNIQUE NULLS NOT DISTINCT (name, spec)
);
COMMENT ON COLUMN medicine.withdrawal_days IS
  '휴약기간(일). 거래명세표 인쇄값이 원천. 최장 35일 — (처)안티펜SM(우진) (§4.9.2)';
COMMENT ON COLUMN medicine.unit_price IS
  '거래명세표는 단가·금액·세액 칸이 공란이므로 대부분 NULL. 원가 집계는 백로그 B4 (§4.9.2)';

-- ── 사료 마스터 §4.8 ─────────────────────────────────────────────────
CREATE TABLE feed (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name     text NOT NULL UNIQUE,   -- 임신/포유/젖돈/육성/체인지/1~3호 벌크·지대
  pack     text CHECK (pack IN ('벌크','지대')),
  unit     text NOT NULL DEFAULT 'kg',
  active   boolean NOT NULL DEFAULT true
);

CREATE TABLE feed_price_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed_id    bigint NOT NULL REFERENCES feed(id),
  valid_from date   NOT NULL,
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  UNIQUE (feed_id, valid_from)
);
COMMENT ON TABLE feed_price_history IS '사료 단가 인상 이력 — 현행 재고관리(사료) 별도 시트 (부록 B)';

-- ── 인덱스 ───────────────────────────────────────────────────────────
CREATE INDEX ON house (farm_id, seq);
CREATE INDEX ON pen   (farm_id, house_id, seq);
CREATE INDEX ON house_category (house_id, seq) WHERE active;
CREATE INDEX ON vaccine_schedule (target, basis) WHERE active;
CREATE INDEX ON medicine (category) WHERE active;
