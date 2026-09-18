-- =====================================================================
-- 010 통제 — 정정전표 · 예외큐 · 일 마감 — 설계문서 §4.12 / §5.7 / §5.9
-- P4 추가만, 수정 없음. 확정 후 정정은 정정전표로. 원본 불변.
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 정정전표 §5.9 ────────────────────────────────────────────────────
CREATE TABLE adjustment (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id        bigint NOT NULL REFERENCES farm(id),
  target_table   text   NOT NULL,
  target_pk      text   NOT NULL,
  target_date    date   NOT NULL,           -- 소급 재계산 시작일
  cascade_days   boolean NOT NULL DEFAULT false,  -- 후속일 파급 여부
  reason         text   NOT NULL,
  payload        jsonb  NOT NULL,           -- 변경할 필드와 값
  status         adjustment_status NOT NULL DEFAULT 'draft',
  issued_by      bigint NOT NULL REFERENCES sec.app_user(id),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  approved_by    bigint REFERENCES sec.app_user(id),
  approved_at    timestamptz,
  applied_at     timestamptz,
  reject_reason  text,
  -- SoD-2 : 발행자 ≠ 승인자
  CONSTRAINT sod2_issuer_ne_approver
    CHECK (approved_by IS NULL OR approved_by <> issued_by),
  CONSTRAINT chk_approved CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT chk_applied  CHECK (applied_at IS NULL OR status = 'applied')
);
COMMENT ON TABLE adjustment IS
  '월 10건 수준(회신 104번)이므로 프로세스는 가볍게 유지한다. 발행자 ≠ 승인자만 강제 (§5.9).
   마감 후 당일 한정 정정은 실장 승인 (회신 105번)';

-- ── 예외큐 §5.8 ──────────────────────────────────────────────────────
-- 설계문서의 테이블명은 exception 이나 PL/pgSQL 예약어와 혼동되므로 exception_queue 로 둔다.
CREATE TABLE exception_queue (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id       bigint NOT NULL REFERENCES farm(id),
  event_date    date   NOT NULL,
  house_id      bigint,
  pen_id        bigint,
  severity      exception_severity NOT NULL,
  rule_code     text   NOT NULL,            -- V1~V10, L4-*, SOD-*
  message       text   NOT NULL,
  ref_table     text,
  ref_pk        text,
  status        exception_status NOT NULL DEFAULT 'open',
  resolved_by   bigint REFERENCES sec.app_user(id),
  resolved_at   timestamptz,
  resolve_note  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (house_id, farm_id) REFERENCES house (id, farm_id),
  FOREIGN KEY (pen_id,   farm_id) REFERENCES pen   (id, farm_id),
  CONSTRAINT chk_resolved CHECK (
      (status IN ('resolved','waived')) = (resolved_at IS NOT NULL)
  ),
  CONSTRAINT chk_resolve_note CHECK (status <> 'waived' OR resolve_note IS NOT NULL)
);
COMMENT ON TABLE exception_queue IS
  '본사 기본 화면. 본사는 종합일보를 취합하지 않고 예외만 본다 (§5.8).
   severity block 이 1건이라도 열려 있으면 일 마감이 차단된다 (L5)';

-- 같은 규칙·같은 대상에 대해 열린 예외는 하나만 유지한다
CREATE UNIQUE INDEX exception_queue_open_uk
  ON exception_queue (farm_id, event_date, rule_code, COALESCE(ref_table,''), COALESCE(ref_pk,''))
  WHERE status = 'open';

-- ── 본사 ↔ 현장 코멘트 §5.8 ──────────────────────────────────────────
-- 카톡 왕복을 대체한다 (회신 106번).
CREATE TABLE report_comment (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id  bigint NOT NULL REFERENCES daily_report(id) ON DELETE CASCADE,
  exception_id bigint REFERENCES exception_queue(id),
  author_id  bigint NOT NULL REFERENCES sec.app_user(id),
  body       text   NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX ON report_comment (report_id, created_at);

-- ── 일 마감 §5.7 ─────────────────────────────────────────────────────
CREATE TABLE day_close (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id     bigint NOT NULL REFERENCES farm(id),
  close_date  date   NOT NULL,
  closed_by   bigint NOT NULL REFERENCES sec.app_user(id),
  closed_at   timestamptz NOT NULL DEFAULT now(),
  reopened_by bigint REFERENCES sec.app_user(id),
  reopened_at timestamptz,
  reopen_reason text,
  UNIQUE (farm_id, close_date),
  CONSTRAINT chk_reopen CHECK ((reopened_by IS NULL) = (reopened_at IS NULL))
);
COMMENT ON TABLE day_close IS
  'L5 마감 게이트 통과 기록. 마감·마감해제는 hq_manager 단독 (SoD-4).
   마감해제는 사유 필수';

CREATE INDEX ON adjustment (farm_id, target_date DESC);
CREATE INDEX ON adjustment (status) WHERE status IN ('draft','pending');
CREATE INDEX ON exception_queue (farm_id, event_date DESC, severity);
CREATE INDEX ON exception_queue (status, severity) WHERE status = 'open';
