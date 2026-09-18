-- =====================================================================
-- M3-01 스테이징 → daily_report · pen_daily — 설계문서 §9
--
--   · 이벤트를 역산하지 않는다. 일별 스냅샷만 적재한다
--   · 8/6 이전은 종이 기록이므로 대상이 아니다 (회신 109번)
--   · app.migration = 'on' 으로 V2(전일두수 자동이월)·V5(전일 확정)를 우회한다.
--     과거 일보의 전일두수는 그 날 적힌 값을 그대로 써야 하기 때문이다
--
-- 선행: m3_00_staging.sql 실행 + CSV 적재
--   \copy app.m3_daily_raw(house_code,pen_code,category_code,report_date,
--     opening_head,in_head,out_head,internal_out_head,sold_head,dead_head,
--     excel_closing,owner_transfer_head,weaned_out_head,
--     recurred_head,aborted_head,infertile_head,
--     entry_date,birth_date_avg,entry_weight,sex_mix,note)
--     FROM 'db/migration/m3_pen_daily.csv' CSV HEADER
-- =====================================================================
SET search_path = app, sec, extensions, public;

BEGIN;

SET LOCAL app.migration = 'on';

-- ── 적재 계정 ────────────────────────────────────────────────────────
-- 과거 데이터의 작성자는 알 수 없다. 사람 계정을 빌려 쓰면 감사로그가 거짓이 되므로
-- 전용 시스템 계정을 만들어 명시한다.
INSERT INTO sec.app_user (login_id, name, password_hash, status, emp_no)
VALUES ('system.m3', 'M3 과거자료 적재', '!', 'suspended', 'SYS-M3')
ON CONFLICT (login_id) DO NOTHING;

SELECT set_config('app.user_id',
                  (SELECT id::text FROM sec.app_user WHERE login_id = 'system.m3'),
                  true);

-- ── 판독 대상 확인 ───────────────────────────────────────────────────
DO $$
DECLARE v_miss text;
BEGIN
  SELECT string_agg(DISTINCT x, ', ') INTO v_miss FROM (
    SELECT s.house_code AS x FROM app.m3_daily_raw s
     WHERE NOT EXISTS (SELECT 1 FROM app.house h WHERE h.code = s.house_code)
    UNION
    SELECT s.house_code || '/' || s.pen_code FROM app.m3_daily_raw s
      JOIN app.house h ON h.code = s.house_code
     WHERE s.pen_code <> ''
       AND NOT EXISTS (SELECT 1 FROM app.pen p
                        WHERE p.house_id = h.id AND p.code = s.pen_code)
    UNION
    SELECT '축종:' || s.category_code FROM app.m3_daily_raw s
     WHERE s.category_code <> ''
       AND NOT EXISTS (SELECT 1 FROM app.pig_category c WHERE c.code = s.category_code)
  ) t;
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION '마스터에 없는 코드: %', v_miss;
  END IF;
END $$;

-- ── 일보 헤더 ────────────────────────────────────────────────────────
-- 과거 일보는 이미 종결된 기록이므로 locked 로 넣는다.
-- confirmed_by 는 비운다 — 확정한 사람이 실제로 누구였는지 모른다 (SoD-1 위반 아님).
INSERT INTO app.daily_report
  (farm_id, house_id, report_date, status, author_id,
   submitted_at, confirmed_at, locked_at, is_baseline, note_text)
SELECT h.farm_id, h.id, s.report_date, 'locked',
       (SELECT id FROM sec.app_user WHERE login_id = 'system.m3'),
       s.report_date + time '18:30', s.report_date + time '18:30',
       s.report_date + time '18:30',
       -- 돈사별 첫날은 이월 기준이 없으므로 기준일로 표시한다
       s.report_date = MIN(s.report_date) OVER (PARTITION BY s.house_code),
       'M3 과거자료 적재 — 현행 일보 엑셀 판독본'
  FROM (SELECT DISTINCT house_code, report_date FROM app.m3_daily_raw) s
  JOIN app.house h ON h.code = s.house_code
ON CONFLICT (report_date, house_id) DO NOTHING;

-- ── 두수 행 ──────────────────────────────────────────────────────────
-- batch_id 는 비운다. 입식일·평균생일이 입식한 날에만 적히고 이후 공란이라
-- (현행 「빈칸 관행」, 회신 33번) 돈군 경계를 신뢰할 수 없다.
-- 판독한 원문은 m3_daily_raw 에 그대로 남아 있으므로 잃는 정보는 없다.
INSERT INTO app.pen_daily
  (report_id, farm_id, house_id, report_date, pen_id, batch_id, category_id,
   opening_head, in_head, out_head, internal_out_head, sold_head, dead_head,
   avg_weight_kg, note)
SELECT dr.id, h.farm_id, h.id, s.report_date,
       p.id, NULL, c.id,
       s.opening_head, s.in_head, s.out_head,
       s.internal_out_head, s.sold_head, s.dead_head,
       NULLIF(regexp_replace(s.entry_weight, '[^0-9.]', '', 'g'), '')::numeric,
       NULLIF(trim(concat_ws(' | ',
              NULLIF(s.note, ''),
              CASE WHEN s.owner_transfer_head > 0
                   THEN '위탁판매(소유권이전) ' || s.owner_transfer_head || '두' END,
              CASE WHEN s.weaned_out_head > 0
                   THEN '이유전출 ' || s.weaned_out_head || '두' END)), '')
  FROM app.m3_daily_raw s
  JOIN app.house h ON h.code = s.house_code
  JOIN app.daily_report dr ON dr.house_id = h.id AND dr.report_date = s.report_date
  LEFT JOIN app.pen p ON p.house_id = h.id AND p.code = s.pen_code AND s.pen_code <> ''
  LEFT JOIN app.pig_category c ON c.code = s.category_code AND s.category_code <> ''
ON CONFLICT DO NOTHING;

COMMIT;

-- ── 적재 검증 ────────────────────────────────────────────────────────
\echo ''
\echo '── 적재 결과 ──'
SELECT count(DISTINCT report_date) AS 일자,
       count(DISTINCT house_id)    AS 돈사,
       count(*)                    AS 행
  FROM app.pen_daily;

\echo ''
\echo '── 엑셀 기재값 vs 시스템 계산값 ──'
SELECT h.name AS 돈사,
       count(*)                                         AS 행,
       count(*) FILTER (WHERE pd.closing_head = s.excel_closing) AS 일치,
       count(*) FILTER (WHERE pd.closing_head <> s.excel_closing) AS 불일치
  FROM app.m3_daily_raw s
  JOIN app.house h  ON h.code = s.house_code
  JOIN app.pen_daily pd
    ON pd.house_id = h.id
   AND pd.report_date = s.report_date
   AND pd.pen_id IS NOT DISTINCT FROM
       (SELECT p.id FROM app.pen p WHERE p.house_id = h.id AND p.code = s.pen_code)
   AND pd.category_id IS NOT DISTINCT FROM
       (SELECT c.id FROM app.pig_category c WHERE c.code = s.category_code)
 WHERE s.excel_closing IS NOT NULL
 GROUP BY h.name, h.seq
 ORDER BY h.seq;

\echo ''
\echo '다음: 불일치 행은 app.m3_daily_raw 와 대조해 현장 확인 목록으로 뽑는다.'
