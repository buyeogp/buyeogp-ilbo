-- =====================================================================
-- 029 본인 확정 — 허용하되 남긴다 (발주처 요구 2026-10-13, B안)
--
-- SoD-1(작성자 ≠ 확정자)을 DB 제약으로 막고 있었다. 본사가 현장 기능을 함께 쓰게 되면서(028)
-- 본사 한 사람이 시작한 일보를 다른 본사 분이 없을 때 끝낼 수 없게 됐다.
--
-- 제약은 내린다. 대신:
--   · self_confirmed — 작성자 = 확정자 를 DB 가 스스로 계산해 둔다(생성열 — 앱이 거짓으로 못 씀)
--   · 화면·제출 현황·PDF 가 이 값을 보고 「본인 확정」을 찍는다
--   · API 는 본인 확정에 명시 확인(selfConfirm)을 요구한다 — 실수로 누르지 않게
-- 확정자를 비우면(확정 해제) false 로 돌아간다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

ALTER TABLE app.daily_report DROP CONSTRAINT IF EXISTS sod1_author_ne_confirmer;

ALTER TABLE app.daily_report
  ADD COLUMN IF NOT EXISTS self_confirmed boolean
    GENERATED ALWAYS AS (confirmed_by IS NOT NULL AND confirmed_by = author_id) STORED;

COMMENT ON COLUMN app.daily_report.self_confirmed IS
  '작성자가 직접 확정했다 — 화면·제출 현황·PDF 에 「본인 확정」 표시 (029, SoD-1 완화)';
