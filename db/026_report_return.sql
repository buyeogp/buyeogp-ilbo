-- =====================================================================
-- 026 제출 뒤 고치는 길 — 제출 취소(팀장) · 되돌려 보내기(본사)
--
-- 상태 전이 submitted → draft 는 012 가 처음부터 허용했지만 쓰는 곳이 없었다.
-- 확정 전이라면 정정전표까지 갈 일이 아니다: 팀장이 스스로 거두거나, 본사가
-- 사유를 붙여 돌려보내면 된다. 사유는 팀장 화면에 그대로 보여야 하므로 남긴다.
-- (누가 언제 바꿨는지는 감사로그에도 남는다 — daily_report 는 감사 대상이다)
-- =====================================================================
SET search_path = app, sec, extensions, public;

ALTER TABLE app.daily_report
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS returned_at   timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by   bigint REFERENCES sec.app_user(id);

COMMENT ON COLUMN app.daily_report.return_reason IS
  '본사가 되돌려 보낸 사유 (팀장이 스스로 거두면 「제출 취소」). 다시 제출하면 지운다 (026)';
