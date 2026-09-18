-- =====================================================================
-- 006 번식 — 설계문서 §4.6
-- 종부 관리대장 · 분만 관리대장 · 모돈카드 세 문서를 하나의 데이터로 합친다.
-- 지금은 모돈 1두의 1산차 정보가 4곳(종부대장 1행 + 분만대장 1행 +
-- 모돈카드 1열 + 일보 두수)에 기록된다 — 이 프로젝트 최대의 중복 제거 (§4.6.3).
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 모돈 개체 §4.6.3 (모돈카드 1장 = 1행) ────────────────────────────
CREATE TABLE sow (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id         bigint NOT NULL REFERENCES farm(id),
  ear_tag         text   NOT NULL,
  breed           text,
  birth_date      date,
  purchase_date   date,                    -- 자가 생산 후보돈은 NULL
  first_heat_date date,
  status          sow_status NOT NULL DEFAULT '후보',
  current_pen_id  bigint,
  stayed_since    date,                    -- 체류돈 전환일 (△ 미확정 시)
  culling_date    date,
  culling_reason  text,
  source          text NOT NULL DEFAULT 'auto'
                  CHECK (source IN ('ledger','auto','manual')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, ear_tag),
  UNIQUE (id, farm_id),
  FOREIGN KEY (current_pen_id, farm_id) REFERENCES pen (id, farm_id),
  CHECK (status <> '도태' OR culling_date IS NOT NULL)
);
COMMENT ON COLUMN sow.ear_tag IS
  '이각번호 문자열. -A 접미사는 기등록 번호 재사용 시 구분자이므로
   2129 와 2129-A 는 서로 다른 개체다 (9/8 회신, §4.6.1)';
COMMENT ON COLUMN sow.source IS
  'ledger = 대장 8주치에서 초기 추출(400~500두) / auto = 운영 중 미등록 번호 자동 생성 / manual = 수기 등록.
   전체 목록 미확보(R-A) → 종부 사이클 1회전(4~5개월) 후 사실상 전량 (§4.6.3)';
COMMENT ON COLUMN sow.stayed_since IS
  '임신진단 △ 가 토요일까지 최종 확정되지 않으면 체류돈 자격 획득.
   이후 발정주기 1회전(약 21일) 무발정 시 도태 결정 (9/8 회신)';

-- ── 웅돈 개체 ────────────────────────────────────────────────────────
-- 설계문서에 별도 스키마가 없으나 백로그 B2(모돈·웅돈 마스터 완성)와
-- §4.6.3(웅돈은 대장에서 이미 대부분 확인된다 — 15두 내외)에 근거해 신설한다.
CREATE TABLE boar (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id    bigint NOT NULL REFERENCES farm(id),
  ear_tag    text   NOT NULL,
  breed      text,
  birth_date date,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','culled','dead')),
  source     text NOT NULL DEFAULT 'auto' CHECK (source IN ('ledger','auto','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, ear_tag),
  UNIQUE (id, farm_id)
);

-- ── 교배 §4.6.1 (종부 관리대장 1행 = 1건) ────────────────────────────
CREATE TABLE breeding (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id           bigint NOT NULL REFERENCES farm(id),
  week_no           int,                    -- 대장 헤더. 표시용 라벨
  mating_date       date   NOT NULL,
  mating_session    mating_session,         -- 종부일 접미사 A=오전 / P=오후
  sow_id            bigint NOT NULL,
  sow_ear_tag       text   NOT NULL,        -- 대장 기재 원문 스냅샷
  parity            int    CHECK (parity IS NULL OR parity >= 0),
  is_gilt           boolean NOT NULL DEFAULT false,   -- 비고 '후'
  breed             text,
  mating_kind       mating_kind NOT NULL DEFAULT '일반',
  house_id          bigint,                 -- 종부사 / 임신1동 / 임신2동 / 순치사

  -- V6-3 : 분만예정일 = 종부일 + 114. 생성열이므로 입력 불가
  expected_farrow_date date GENERATED ALWAYS AS (mating_date + 114) STORED,

  diagnosis_result     diagnosis_result NOT NULL DEFAULT '미실시',
  diagnosis_1_date     date,                -- 4주차 1차
  diagnosis_2_date     date,                -- 5주차 2차
  suspect_confirm_date date,                -- △ 최종 확정일 (토요일)
  outcome              breeding_outcome NOT NULL DEFAULT '진행중',
  outcome_date         date,
  note                 text,
  created_by           bigint REFERENCES sec.app_user(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, farm_id),
  FOREIGN KEY (sow_id,   farm_id) REFERENCES sow   (id, farm_id),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id),
  -- 같은 모돈이 같은 날 오전·오후로 두 건 기록될 수 있으므로 session 까지 키에 넣는다
  UNIQUE NULLS NOT DISTINCT (sow_id, mating_date, mating_session)
);
COMMENT ON COLUMN breeding.mating_kind IS
  '대장 웅돈번호 칸의 Y 표기는 웅돈이 아니라 순종교배(YY) 표시다.
   자체 모돈으로 쓸 후보돈 생산용 교배 (C14 / 9/8 회신)';
COMMENT ON COLUMN breeding.mating_session IS
  '대장의 별도 「교배타임」 칸은 전부 비어 있고 종부일 접미사로 운영 중이므로 필드를 통합했다 (§4.6.1)';

-- ── 교배 회차별 웅돈 §4.6.1 ──────────────────────────────────────────
CREATE TABLE mating_line (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  breeding_id   bigint NOT NULL,
  farm_id       bigint NOT NULL,
  seq           int    NOT NULL CHECK (seq IN (1,2,3)),
  boar_id       bigint,
  boar_ear_tag  text,                       -- 순종교배 시 미기재 → NULL 허용
  mated_at      date,
  UNIQUE (breeding_id, seq),
  FOREIGN KEY (breeding_id, farm_id) REFERENCES breeding (id, farm_id) ON DELETE CASCADE,
  FOREIGN KEY (boar_id,     farm_id) REFERENCES boar     (id, farm_id)
);
COMMENT ON TABLE mating_line IS
  '회차별 웅돈. 3회 교배는 실제로 발생하므로 seq 3 을 존치한다 (C15 / 9/8 회신).
   대장에서 동일 웅돈은 " 로 생략되지만 시스템은 값을 전개해 저장한다';

-- ── 후속 조치 §4.6.1 ─────────────────────────────────────────────────
-- 현행 대장은 「3회」 칸에 재종부 8.17 / 도태 8.21 / 도태예정 같은 조치를 적는다.
-- 칸 분리에 현장 동의 완료.
CREATE TABLE breeding_action (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  breeding_id bigint NOT NULL,
  farm_id     bigint NOT NULL,
  action_date date   NOT NULL,
  action_type breeding_action_type NOT NULL,
  note        text,
  created_by  bigint REFERENCES sec.app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (breeding_id, farm_id) REFERENCES breeding (id, farm_id) ON DELETE CASCADE
);

-- ── 유산 §4.6.1 (유산분석 시트) ──────────────────────────────────────
CREATE TABLE abortion (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  breeding_id    bigint NOT NULL,
  farm_id        bigint NOT NULL,
  abortion_date  date   NOT NULL,
  mating_date    date   NOT NULL,           -- 계산용 스냅샷 (생성열은 동일 행만 참조 가능)
  abortion_age_days int GENERATED ALWAYS AS (abortion_date - mating_date) STORED,
  house_id       bigint,
  pen_id         bigint,
  note           text,
  created_by     bigint REFERENCES sec.app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (breeding_id, farm_id) REFERENCES breeding (id, farm_id) ON DELETE CASCADE,
  FOREIGN KEY (house_id,    farm_id) REFERENCES house    (id, farm_id),
  FOREIGN KEY (pen_id,      farm_id) REFERENCES pen      (id, farm_id),
  CHECK (abortion_date >= mating_date)
);
COMMENT ON TABLE abortion IS
  '유산. 현행 유산분석 시트가 발생장소를 이미 기록하고 있다(임신1동 중앙 집중) →
   L4 「유산 다발」 탐지의 근거 (§5.6)';

-- ── 분만 §4.6.2 (분만 관리대장 1행 = 1건) ────────────────────────────
CREATE TABLE farrowing (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id            bigint NOT NULL REFERENCES farm(id),
  week_no            int,                   -- 분만 주차. 종부 주차와 독립된 카운터
  farrow_date        date   NOT NULL,
  pen_id             bigint,                -- 대장의 동·방
  sow_id             bigint NOT NULL,
  sow_ear_tag        text   NOT NULL,
  parity             int CHECK (parity IS NULL OR parity >= 0),
  breed              text,
  breeding_id        bigint,                -- 종부대장 ↔ 분만대장 연결 키
  farrow_type        farrow_type NOT NULL DEFAULT '정상',
  expected_farrow_date date,

  total_born         int NOT NULL DEFAULT 0 CHECK (total_born       >= 0),
  stillborn          int NOT NULL DEFAULT 0 CHECK (stillborn        >= 0),  -- 순수 사산만
  crushed            int NOT NULL DEFAULT 0 CHECK (crushed          >= 0),  -- 압사 (분리 신설)
  mummified          int NOT NULL DEFAULT 0 CHECK (mummified        >= 0),
  deformed           int NOT NULL DEFAULT 0 CHECK (deformed         >= 0),
  culled_at_birth    int NOT NULL DEFAULT 0 CHECK (culled_at_birth  >= 0),
  small              int NOT NULL DEFAULT 0 CHECK (small            >= 0),  -- 체미

  -- V6 : 실산 = 총산 − (사산 + 압사 + 미라 + 기형 + 도태 + 체미)
  live_born int GENERATED ALWAYS AS (
      total_born - (stillborn + crushed + mummified + deformed + culled_at_birth + small)
  ) STORED,

  -- 대장 기재값. 마이그레이션 시 등식이 깨진 행(예: 모돈 2390 — 11 − 2 ≠ 8)을 드러낸다
  live_born_reported int CHECK (live_born_reported IS NULL OR live_born_reported >= 0),
  live_born_variance int GENERATED ALWAYS AS (
      live_born_reported
      - (total_born - (stillborn + crushed + mummified + deformed + culled_at_birth + small))
  ) STORED,

  female_count           int CHECK (female_count IS NULL OR female_count >= 0),
  male_count             int CHECK (male_count   IS NULL OR male_count   >= 0),
  birth_weight_nominal   numeric(4,2),
  note                   text,
  created_by             bigint REFERENCES sec.app_user(id),
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT v6_live_born_nonneg CHECK (
      stillborn + crushed + mummified + deformed + culled_at_birth + small <= total_born
  ),
  UNIQUE (id, farm_id),
  UNIQUE (sow_id, farrow_date),
  FOREIGN KEY (sow_id,      farm_id) REFERENCES sow      (id, farm_id),
  FOREIGN KEY (pen_id,      farm_id) REFERENCES pen      (id, farm_id),
  FOREIGN KEY (breeding_id, farm_id) REFERENCES breeding (id, farm_id) ON DELETE CASCADE
);
COMMENT ON COLUMN farrowing.crushed IS
  '압사. 현행 대장은 사산 칸에 1+1압사 처럼 혼재 기재하여 등식이 깨진다.
   필드 분리만으로 해소되는 오류 — 현장 동의 완료 (§4.6.2)';
COMMENT ON COLUMN farrowing.birth_weight_nominal IS
  '생시체중 — 실측값이 아니다. 종돈 분양 시 자돈등기대장·혈통증명서 제출용 형식 기재.
   KPI·이상탐지에서 제외하고 혈통증명 서류 출력용으로만 쓴다 (C13 / 9/8 회신)';
COMMENT ON COLUMN farrowing.female_count IS
  '암·수 칸은 전 주차 공란 — 현행 미사용. 존치 여부 확인 중 (§11.2 Q12)';
COMMENT ON COLUMN farrowing.week_no IS
  '종부 주차와 분만 주차는 서로 독립된 카운터이며 대응될 수 없다.
   두 대장은 breeding_id(모돈 개체 + 교배일)로 연결한다 (9/8 회신)';

-- ── 산차별 이력 §4.6.3 (모돈카드 열 1개 = 1행) ───────────────────────
CREATE TABLE parity_record (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sow_id       bigint NOT NULL,
  farm_id      bigint NOT NULL,
  parity       int    NOT NULL CHECK (parity >= 1),
  breeding_id  bigint,
  farrowing_id bigint,
  nursing_start_date date,
  weaning_date date,
  weaned_head  int CHECK (weaned_head IS NULL OR weaned_head >= 0),
  note         text,
  UNIQUE (sow_id, parity),
  FOREIGN KEY (sow_id,       farm_id) REFERENCES sow       (id, farm_id),
  FOREIGN KEY (breeding_id,  farm_id) REFERENCES breeding  (id, farm_id),
  FOREIGN KEY (farrowing_id, farm_id) REFERENCES farrowing (id, farm_id)
);
COMMENT ON COLUMN parity_record.weaned_head IS
  '이유두수. 양자(piglet_transfer)로 총산보다 커질 수 있다 —
   모돈 2589 1산: 총산 11, 이유 12 (§4.6.3 발견 1). 상한 제약을 두지 않는다';

-- ── 양자 §4.6.3 (포유 중 자돈 이동) ──────────────────────────────────
CREATE TABLE piglet_transfer (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farrowing_id       bigint NOT NULL,
  farm_id            bigint NOT NULL,
  event_date         date   NOT NULL,
  direction          piglet_transfer_dir NOT NULL,
  head_count         int    NOT NULL CHECK (head_count > 0),
  counterpart_pen_id bigint,
  counterpart_farrowing_id bigint,
  note               text,
  FOREIGN KEY (farrowing_id,       farm_id) REFERENCES farrowing (id, farm_id) ON DELETE CASCADE,
  FOREIGN KEY (counterpart_pen_id, farm_id) REFERENCES pen       (id, farm_id)
);

-- ── 이유 (부록 A: 이유 현황 → weaning) ───────────────────────────────
-- 설계문서에 스키마가 명시되지 않아 §4.4(수요일 두수 파악, 목요일 실시)와
-- 분만사일보 「이유 현황」에 맞춰 정의한다.
CREATE TABLE weaning (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id         bigint NOT NULL REFERENCES farm(id),
  event_date      date   NOT NULL,
  pen_id          bigint,
  sow_id          bigint,
  farrowing_id    bigint,
  weaned_head     int NOT NULL CHECK (weaned_head >= 0),
  nursing_days    int CHECK (nursing_days IS NULL OR nursing_days >= 0),
  sow_to_pen_id   bigint,                  -- 되돌림: 이유모돈 → 순치사
  note            text,
  created_by      bigint REFERENCES sec.app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pen_id,        farm_id) REFERENCES pen       (id, farm_id),
  FOREIGN KEY (sow_id,        farm_id) REFERENCES sow       (id, farm_id),
  FOREIGN KEY (farrowing_id,  farm_id) REFERENCES farrowing (id, farm_id),
  FOREIGN KEY (sow_to_pen_id, farm_id) REFERENCES pen       (id, farm_id)
);

-- ── 인덱스 ───────────────────────────────────────────────────────────
CREATE INDEX ON sow (farm_id, status);
CREATE INDEX ON sow (farm_id, ear_tag text_pattern_ops);   -- 유사 번호 제시 (오타 검출)
CREATE INDEX ON breeding (farm_id, mating_date DESC);
CREATE INDEX ON breeding (sow_id, mating_date DESC);
CREATE INDEX ON breeding (farm_id, week_no);
CREATE INDEX ON breeding (expected_farrow_date) WHERE outcome IN ('진행중','임신');
CREATE INDEX ON breeding (diagnosis_result) WHERE diagnosis_result = '의심';
CREATE INDEX ON mating_line (boar_id);
CREATE INDEX ON farrowing (farm_id, farrow_date DESC);
CREATE INDEX ON farrowing (sow_id, farrow_date DESC);
CREATE INDEX ON farrowing (pen_id, farrow_date DESC);
CREATE INDEX ON abortion (farm_id, abortion_date DESC);
CREATE INDEX ON weaning (farm_id, event_date DESC);
