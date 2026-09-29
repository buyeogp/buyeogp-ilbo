-- =====================================================================
-- 025 「빈칸 0으로 채우기」 기록 — 설계문서 §8.1 의 예외를 남긴다
--
-- 빈칸 금지(변동이 없으면 0 을 직접 넣는다)는 「안 봤다」와 「없었다」를 가르기 위한
-- 규칙이다. 분만사처럼 44줄 중 대부분이 매일 변동 없는 일보에서 줄마다 Ctrl+Enter 를
-- 치게 하는 것은 현장에 너무 무거워(발주처 시험 전 피드백), 일괄 채우기를 연다.
-- 대신 **썼다는 사실을 남긴다** — 본사가 확정할 때 「40줄을 한꺼번에 0 으로 채움」이
-- 보여야 「정말 다 봤나」를 물을 수 있다.
--
-- 줄 수는 채울 때의 누계다. 채운 뒤 몇 줄을 다시 고쳐도 줄지 않는다(보수적으로 남긴다).
-- =====================================================================
SET search_path = app, sec, extensions, public;

ALTER TABLE app.daily_report
  ADD COLUMN IF NOT EXISTS bulk_zero_rows int NOT NULL DEFAULT 0 CHECK (bulk_zero_rows >= 0),
  ADD COLUMN IF NOT EXISTS bulk_zero_at   timestamptz;

COMMENT ON COLUMN app.daily_report.bulk_zero_rows IS
  '「빈칸 0으로 채우기」로 채운 줄 수(누계). 본사 확정 화면에 표시 (025)';
