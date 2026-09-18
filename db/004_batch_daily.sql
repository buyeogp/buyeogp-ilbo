-- =====================================================================
-- 004 돈군 · 일보 · 돈방 일계 — 설계문서 §4.2 / §4.11
-- P2 이벤트가 원장, 두수는 파생.
-- P5 계산은 전부 시스템이 — closing_head 를 생성열로 두어 V1 을 구조적으로 보장한다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 돈군 §4.2 ────────────────────────────────────────────────────────
CREATE TABLE batch (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id          bigint NOT NULL REFERENCES farm(id),
  code             text   NOT NULL,
  origin_batch_id  bigint REFERENCES batch(id),          -- 계보 추적
  birth_date_avg   date,
  owner_id         bigint NOT NULL REFERENCES owner(id),
  category_id      bigint REFERENCES pig_category(id),
  sex_mix          sex_mix,
  entry_date       date,
  entry_weight_avg numeric(6,2) CHECK (entry_weight_avg IS NULL OR entry_weight_avg > 0),
  status           batch_status NOT NULL DEFAULT 'active',
  closed_at        date,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (farm_id, code),
  UNIQUE (id, farm_id),
  CHECK (origin_batch_id IS NULL OR origin_batch_id <> id)
);
COMMENT ON TABLE batch IS
  '돈군. 입식일·평균생일·전입체중·일령은 돈방이 아니라 돈군의 속성이다 (§4.2).
   회신 113번: 육성사 위탁판매분은 2회 분할 입식 → 한 돈방에 복수 batch 가능';
COMMENT ON COLUMN batch.birth_date_avg IS
  '평균생일. 일령 = 보고일 − birth_date_avg, 주차 = floor(일령/7), 75일령 도달일 = +75.
   NULL 이면 일령을 계산하지 않는다 — 육성사 #VALUE!(빈 돈방 일령) 해소 (§4.2)';

-- ── 일보 헤더 §4.11 ──────────────────────────────────────────────────
CREATE TABLE daily_report (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id         bigint NOT NULL,
  house_id        bigint NOT NULL,
  report_date     date   NOT NULL,
  status          report_status NOT NULL DEFAULT 'draft',
  author_id       bigint NOT NULL REFERENCES sec.app_user(id),   -- 입력 팀장
  field_writer_id bigint REFERENCES sec.app_user(id),            -- 현장 메모 작성자
  submitted_at    timestamptz,
  confirmed_by    bigint REFERENCES sec.app_user(id),
  confirmed_at    timestamptz,
  locked_at       timestamptz,
  note_text       text,                                          -- 특이사항 원문
  printed_at      timestamptz,                                   -- §6.5 HACCP
  signed_at       timestamptz,
  is_baseline     boolean NOT NULL DEFAULT false,                -- M2 기준일 재고 확정
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_date, house_id),
  UNIQUE (id, farm_id),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id),
  -- SoD-1 : 입력자(팀장) ≠ 확정자(본사)
  CONSTRAINT sod1_author_ne_confirmer
    CHECK (confirmed_by IS NULL OR confirmed_by <> author_id),
  CONSTRAINT chk_status_timestamps CHECK (
        (status = 'draft')
     OR (status = 'submitted' AND submitted_at IS NOT NULL)
     OR (status = 'confirmed' AND submitted_at IS NOT NULL AND confirmed_at IS NOT NULL)
     OR (status = 'locked'    AND confirmed_at IS NOT NULL AND locked_at IS NOT NULL)
  )
);
COMMENT ON COLUMN daily_report.printed_at IS
  '일보 PDF 출력 일시. HACCP 전자기록 불인정 → 출력·서명·3년 보관 (§6.5 B안)';
COMMENT ON COLUMN daily_report.is_baseline IS
  'M2 기준일. true 인 첫 일보만 opening_head 를 수기 확정할 수 있다 (V2 예외)';

-- ── 일보 명세행 §4.11 ────────────────────────────────────────────────
-- 설계문서는 (report, pen, batch) 만 상정했으나 현행 일보 5종을 판독한 결과
-- 돈사마다 행을 쪼개는 축이 다르다(house.count_basis). 세 경우를 한 테이블로 받는다.
--   자돈·육성·검정·비육 : pen_id + batch_id            (category_id NULL)
--   분만1동·분만2동      : pen_id + category_id         (batch_id   NULL)
--   순치·종부·임신1·2동  : category_id                  (pen_id     NULL)
--   계류장               : 셋 다 NULL — 돈사 1행
CREATE TABLE pen_daily (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id              bigint NOT NULL REFERENCES daily_report(id) ON DELETE CASCADE,
  farm_id                bigint NOT NULL,
  house_id               bigint NOT NULL,              -- 트리거 동기화
  report_date            date   NOT NULL,              -- 트리거 동기화
  pen_id                 bigint,                       -- NULL = 돈사 단위 집계행
  batch_id               bigint,                       -- NULL = 빈 돈방 또는 돈군 미적용
  category_id            bigint REFERENCES pig_category(id),

  opening_head           int NOT NULL DEFAULT 0 CHECK (opening_head           >= 0),
  in_head                int NOT NULL DEFAULT 0 CHECK (in_head                >= 0),
  out_head               int NOT NULL DEFAULT 0 CHECK (out_head               >= 0),
  internal_out_head      int NOT NULL DEFAULT 0 CHECK (internal_out_head      >= 0),
  sold_head              int NOT NULL DEFAULT 0 CHECK (sold_head              >= 0),
  dead_head              int NOT NULL DEFAULT 0 CHECK (dead_head              >= 0),
  culled_head            int NOT NULL DEFAULT 0 CHECK (culled_head            >= 0),

  -- V1 : 당일두수 = 전일두수 + 전입 − (전출 + 내부전출 + 판매 + 폐사 + 도태)
  closing_head int GENERATED ALWAYS AS (
      opening_head + in_head
      - out_head - internal_out_head - sold_head - dead_head - culled_head
  ) STORED,

  reported_closing_head  int CHECK (reported_closing_head IS NULL OR reported_closing_head >= 0),

  -- 실사 불일치 (L4)
  variance int GENERATED ALWAYS AS (
      reported_closing_head
      - (opening_head + in_head
         - out_head - internal_out_head - sold_head - dead_head - culled_head)
  ) STORED,

  variance_reason text,
  avg_weight_kg   numeric(6,2) CHECK (avg_weight_kg IS NULL OR avg_weight_kg > 0),
  note            text,

  -- V3 : 출고 합계 ≤ opening + in  (= closing_head >= 0)
  CONSTRAINT v3_no_negative_stock CHECK (
      out_head + internal_out_head + sold_head + dead_head + culled_head
      <= opening_head + in_head
  ),
  -- V4 : 동일 (일자, 돈방, 돈군, 축종구분) 중복 금지. 빈 돈방(전부 NULL)도 1행만 허용
  CONSTRAINT v4_no_duplicate
    UNIQUE NULLS NOT DISTINCT (report_id, pen_id, batch_id, category_id),
  -- 실사 불일치 시 사유 필수 (L4)
  CONSTRAINT l4_variance_needs_reason CHECK (
      reported_closing_head IS NULL
      OR reported_closing_head = (opening_head + in_head
           - out_head - internal_out_head - sold_head - dead_head - culled_head)
      OR variance_reason IS NOT NULL
  ),
  FOREIGN KEY (house_id,  farm_id) REFERENCES house (id, farm_id),
  FOREIGN KEY (pen_id,    farm_id) REFERENCES pen   (id, farm_id),
  FOREIGN KEY (batch_id,  farm_id) REFERENCES batch (id, farm_id)
);
COMMENT ON TABLE pen_daily IS
  '일보의 두수 행 하나. 이름은 설계문서 §4.11 을 따르되 돈방 행뿐 아니라
   돈사 × 축종구분 행(종부사·임신동)과 돈사 1행(계류장)도 담는다';
COMMENT ON COLUMN pen_daily.opening_head IS
  'V2 전일두수. 전일 확정본의 closing_head 를 시스템이 자동 채운다. 수정 불가 (§5.4)';
COMMENT ON COLUMN pen_daily.in_head IS
  '전입 — 돈사간 전입과 동 내부 전입을 합산한 값(현행 일보 「전입」 열과 동일).
   세부 내역은 movement 에서 조회한다 (부록 A)';
COMMENT ON COLUMN pen_daily.closing_head IS
  '당일두수 — 생성열. 사람이 계산하지 않으며 입력할 수도 없다 (P5 / V1)';
COMMENT ON COLUMN pen_daily.reported_closing_head IS
  '현장 실사값. 월 1회 실사 시점에만 입력된다. closing_head 와 다르면 사유 필수 (P2 / L4)';
COMMENT ON COLUMN pen_daily.category_id IS
  '분만사는 돈방 × 축종구분(분만대기돈·포유모돈·포유자돈·이유자돈),
   종부·임신사는 돈방 없이 축종구분만으로 집계한다 — 현행 일보 판독 결과';

-- 일령·주차는 저장하지 않는다. report_date 와 batch.birth_date_avg 의 순함수이므로
-- v_pen_daily 뷰에서 계산한다 (설계문서 §4.11 대비 의도적 이탈 — README 참조).

-- ── 제출 서명 §4.12 / §6.5 ───────────────────────────────────────────
CREATE TABLE submission_signature (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id    bigint NOT NULL REFERENCES daily_report(id) ON DELETE CASCADE,
  user_id      bigint NOT NULL REFERENCES sec.app_user(id),
  action       audit_action NOT NULL,
  signed_at    timestamptz NOT NULL DEFAULT now(),
  content_hash bytea NOT NULL,          -- sha256(일보 스냅샷 정규화 JSON)
  ip           inet
);
CREATE INDEX ON submission_signature (report_id, signed_at);
COMMENT ON TABLE submission_signature IS
  '출력물과 시스템 데이터가 동일함을 증명한다. 로그인 세션 + content_hash (§6.5)';

-- ── 인덱스 ───────────────────────────────────────────────────────────
CREATE INDEX ON daily_report (farm_id, report_date DESC);
CREATE INDEX ON daily_report (house_id, report_date DESC);
CREATE INDEX ON daily_report (status) WHERE status <> 'locked';
CREATE INDEX ON pen_daily (pen_id, report_date DESC);
CREATE INDEX ON pen_daily (batch_id, report_date DESC) WHERE batch_id IS NOT NULL;
CREATE INDEX ON pen_daily (farm_id, report_date);
CREATE INDEX ON pen_daily (house_id, report_date DESC);
CREATE INDEX ON pen_daily (report_id);
CREATE INDEX ON batch (farm_id, status) WHERE status = 'active';
