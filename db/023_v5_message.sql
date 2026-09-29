-- =====================================================================
-- 023 V5 문구 — 현장이 읽고 무엇을 해야 하는지 알 수 있게
--
-- 전: 「V5: 전일(2026-09-21) 일보가 아직 확정되지 않았습니다. 상태=draft — 오류는 하루를 넘지 못한다(P8)」
--     9/29 를 시작하는데 「전일 9/21」이 나와 헷갈렸다. 규칙은 어제가 아니라 바로 앞 일보를 본다.
-- 후: 「V5: 앞 일보(2026-09-21)가 아직 확정되지 않았습니다(작성 중). 그 일보를 먼저 …」
-- 동작은 같다 — 문구만 바뀐다. 011 도 같은 본문으로 고쳐 두었다(새로 설치할 때).
-- =====================================================================
SET search_path = app, sec, extensions, public;

CREATE OR REPLACE FUNCTION app.fn_v5_prev_day_confirmed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = app, sec, extensions, public AS $$
DECLARE r record;
BEGIN
  IF app.is_migration() OR NEW.is_baseline THEN RETURN NEW; END IF;

  SELECT report_date, status INTO r
    FROM daily_report
   WHERE house_id = NEW.house_id
     AND report_date < NEW.report_date
   ORDER BY report_date DESC
   LIMIT 1;

  -- 「어제」가 아니라 「바로 앞 일보」다. 빈 날이 있으면 그 앞 일보를 본다.
  -- 현장이 읽는 문구라 무엇을 하면 풀리는지까지 말한다
  IF FOUND AND r.status NOT IN ('confirmed','locked') THEN
    RAISE EXCEPTION
      'V5: 앞 일보(%)가 아직 확정되지 않았습니다(%). 그 일보를 먼저 제출·확정해야 다음 날짜를 시작할 수 있습니다.',
      r.report_date,
      CASE r.status WHEN 'draft' THEN '작성 중' WHEN 'submitted' THEN '제출됨 · 확정 대기' ELSE r.status::text END
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
