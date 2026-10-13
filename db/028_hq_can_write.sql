-- =====================================================================
-- 028 본사도 현장 기능을 모두 — 일보 시작 · 숫자 입력 · 폐사·도태 · 제출 (발주처 요구 2026-10-13)
--
-- 「현장 계정은 현장만, 본사 계정은 본사·현장 모두」 (서민부 실장).
-- 숫자 수정(pen_daily)·폐사 원장은 014 가 이미 본사를 열어 두었고, 막힌 것은
-- 일보를 새로 시작하는 INSERT(p_report_insert → can_write_house) 하나였다.
--
-- SoD-1(작성자 ≠ 확정자)은 그대로다 — 본사가 직접 **시작한** 일보는 그 사람이
-- 확정할 수 없고 다른 본사 직원이 확정한다 (daily_report.sod1_author_ne_confirmer).
-- 팀장이 시작한 일보를 본사가 고친 뒤 확정하는 것은 막지 않는다 — 누가 어느 칸을
-- 고쳤는지는 감사로그(pen_daily 변경 전·후 값)에 남는다.
-- =====================================================================
SET search_path = app, sec, extensions, public;

CREATE OR REPLACE FUNCTION app.can_write_house(p_house_id bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path = app, sec, extensions, public AS $$
  SELECT app.has_role('team_lead','farm_manager','hq_staff','hq_manager')
     AND app.can_see_house(p_house_id);
$$;
