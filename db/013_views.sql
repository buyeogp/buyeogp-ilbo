-- =====================================================================
-- 013 뷰 — 설계문서 §4.13 / §8.2
-- P6 종합일보는 산출물. 본사는 취합하지 않고 확정만 한다.
-- 대장 하단 주차 집계는 저장하지 않고 전부 파생한다 (§4.6.1 / 부록 A).
-- =====================================================================
SET search_path = app, sec, extensions, public;

-- ── 돈방 일계 + 파생 (일령·주차·75일령 도달일) ───────────────────────
CREATE VIEW v_pen_daily AS
SELECT pd.id, pd.report_id, pd.farm_id, pd.report_date,
       h.id AS house_id, h.code AS house_code, h.name AS house_name,
       h.type AS house_type, h.seq AS house_seq, h.count_basis,
       p.id AS pen_id, p.code AS pen_code, p.seq AS pen_seq,
       cat.id AS category_id, cat.name AS category_name,
       COALESCE(p.code, cat.name, h.name) AS row_label,
       b.id AS batch_id, b.code AS batch_code, b.sex_mix,
       o.name AS owner_name, o.is_consign,
       b.birth_date_avg, b.entry_date, b.entry_weight_avg,
       app.age_days(b.birth_date_avg, pd.report_date) AS age_days,
       app.age_week(b.birth_date_avg, pd.report_date) AS age_week,
       b.birth_date_avg + 75 AS day75_date,
       pd.opening_head, pd.in_head, pd.out_head, pd.internal_out_head,
       pd.sold_head, pd.dead_head, pd.culled_head, pd.closing_head,
       pd.reported_closing_head, pd.variance, pd.variance_reason,
       pd.avg_weight_kg, pd.note,
       dr.status, dr.author_id, dr.confirmed_by
  FROM pen_daily pd
  JOIN daily_report dr ON dr.id = pd.report_id
  JOIN house h ON h.id = pd.house_id
  LEFT JOIN pen   p   ON p.id = pd.pen_id
  LEFT JOIN pig_category cat ON cat.id = pd.category_id
  LEFT JOIN batch b ON b.id = pd.batch_id
  LEFT JOIN owner o ON o.id = b.owner_id;

COMMENT ON VIEW v_pen_daily IS
  '일령·주차·75일령 도달일은 저장하지 않고 여기서 계산한다.
   batch 가 없으면(빈 돈방) NULL 이 되어 육성사 #VALUE! 가 재현되지 않는다 (§4.2 / D7).
   row_label 은 화면·PDF 의 행 머리글 — 돈방코드 / 축종구분명 / 돈사명 순으로 채워진다';

-- ── 종합일보 (§4.13) — 읽기 전용 ─────────────────────────────────────
CREATE VIEW v_daily_summary AS
SELECT pd.farm_id, pd.report_date, pd.house_id, pd.house_name, pd.house_type, pd.house_seq,
       count(*) FILTER (WHERE pd.batch_id IS NOT NULL) AS pen_in_use,
       sum(pd.opening_head)      AS opening_head,
       sum(pd.in_head)           AS in_head,
       sum(pd.out_head)          AS out_head,
       sum(pd.internal_out_head) AS internal_out_head,
       sum(pd.sold_head)         AS sold_head,
       sum(pd.dead_head)         AS dead_head,
       sum(pd.culled_head)       AS culled_head,
       sum(pd.closing_head)      AS closing_head,
       CASE WHEN sum(pd.opening_head) > 0
            THEN round(100.0 * sum(pd.dead_head) / sum(pd.opening_head), 3) END AS mortality_rate_pct,
       min(pd.status) AS status
  FROM v_pen_daily pd
 GROUP BY pd.farm_id, pd.report_date, pd.house_id, pd.house_name, pd.house_type, pd.house_seq;

-- 월계 (종합일보의 「일/월계」 열)
CREATE VIEW v_monthly_summary AS
SELECT s.farm_id,
       to_char(s.report_date, 'YYYYMM') AS year_month,
       s.house_id, s.house_name,
       sum(s.in_head)           AS in_head,
       sum(s.out_head)          AS out_head,
       sum(s.internal_out_head) AS internal_out_head,
       sum(s.sold_head)         AS sold_head,
       sum(s.dead_head)         AS dead_head,
       sum(s.culled_head)       AS culled_head,
       (array_agg(s.closing_head ORDER BY s.report_date DESC))[1] AS closing_head,
       max(s.report_date) AS last_report_date
  FROM v_daily_summary s
 GROUP BY s.farm_id, to_char(s.report_date, 'YYYYMM'), s.house_id, s.house_name;

-- ── 돈사 × 축종구분 현황 (종부 임신사 일지 「1. 두수 현황」) ──────────
CREATE VIEW v_house_category_daily AS
SELECT pd.farm_id, pd.report_date, pd.house_id, pd.house_name, pd.house_seq,
       pd.category_id, pd.category_name,
       sum(pd.opening_head) AS opening_head,
       sum(pd.in_head)      AS in_head,
       sum(pd.out_head)     AS out_head,
       sum(pd.dead_head)    AS dead_head,
       sum(pd.culled_head)  AS culled_head,
       sum(pd.closing_head) AS closing_head
  FROM v_pen_daily pd
 WHERE pd.category_id IS NOT NULL
 GROUP BY pd.farm_id, pd.report_date, pd.house_id, pd.house_name, pd.house_seq,
          pd.category_id, pd.category_name;

COMMENT ON VIEW v_house_category_daily IS
  '종부 임신사 일지의 순치사/종부사/임신1동/임신2동 x 축종구분 블록과
   분만사 일지의 포유모돈/포유자돈 열을 같은 형태로 돌려준다';

-- ── 종부 주차 집계 (§4.6.1 대장 하단) ────────────────────────────────
CREATE VIEW v_breeding_weekly AS
SELECT b.farm_id, b.week_no,
       min(b.mating_date) AS week_from,
       max(b.mating_date) AS week_to,
       count(*)                                          AS mated,
       count(*) FILTER (WHERE b.outcome = '재발')        AS recurred,
       count(*) FILTER (WHERE b.diagnosis_result = '의심') AS suspect,
       count(*) FILTER (WHERE b.diagnosis_result = '불임') AS infertile,
       count(*) FILTER (WHERE b.outcome = '도태')        AS culled,
       count(*) FILTER (WHERE b.outcome = '임신')        AS pregnant,
       round(100.0 * count(*) FILTER (WHERE b.outcome = '임신')
             / NULLIF(count(*), 0), 2)                   AS conception_rate_pct
  FROM breeding b
 GROUP BY b.farm_id, b.week_no;

COMMENT ON VIEW v_breeding_weekly IS
  '임신 = 교배 − (재발 + 의심 + 불임 + 도태), 수태율 = 임신 / 교배.
   대장 31~34주차 손계산과 검증 결과 전건 일치하므로 산식을 그대로 쓴다 (§4.6.1)';

-- 교배 요일별 분포 (현행 「교배요일」 시트 — #DIV/0! 이 재현되지 않는다)
CREATE VIEW v_breeding_by_weekday AS
SELECT farm_id, week_no,
       EXTRACT(DOW FROM mating_date)::int AS weekday,
       to_char(mating_date, 'Dy')         AS weekday_name,
       count(*) AS mated
  FROM breeding
 GROUP BY farm_id, week_no, EXTRACT(DOW FROM mating_date), to_char(mating_date, 'Dy');

-- ── 분만 주차 집계 (§4.6.2) ──────────────────────────────────────────
CREATE VIEW v_farrowing_weekly AS
SELECT f.farm_id, f.week_no,
       count(*)                AS litters,
       sum(f.total_born)       AS total_born,
       sum(f.stillborn)        AS stillborn,
       sum(f.crushed)          AS crushed,
       sum(f.mummified)        AS mummified,
       sum(f.deformed)         AS deformed,
       sum(f.culled_at_birth)  AS culled_at_birth,
       sum(f.small)            AS small,
       sum(f.live_born)        AS live_born,
       round(sum(f.total_born)::numeric / NULLIF(count(*), 0), 2) AS avg_total_born,
       round(sum(f.live_born)::numeric  / NULLIF(count(*), 0), 2) AS avg_live_born,
       round(100.0 * sum(f.stillborn) / NULLIF(sum(f.total_born), 0), 2) AS stillborn_rate_pct,
       count(*) FILTER (WHERE f.live_born_variance IS NOT NULL
                          AND f.live_born_variance <> 0) AS ledger_mismatch
  FROM farrowing f
 GROUP BY f.farm_id, f.week_no;

COMMENT ON VIEW v_farrowing_weekly IS
  'ledger_mismatch 는 종이 대장 기재값과 등식이 어긋난 행 수.
   사산 칸 복합 표기(1+1압사) 로 깨진 건을 마이그레이션 후 찾아내기 위한 열이다 (§4.6.2)';

-- ── 임신돈 분포도 (종부사일보 주령 1~17) ─────────────────────────────
CREATE VIEW v_pregnancy_distribution AS
SELECT b.farm_id,
       d.as_of,
       ((d.as_of - b.mating_date) / 7) + 1 AS preg_week,
       count(*) AS head
  FROM breeding b
  CROSS JOIN LATERAL (SELECT current_date AS as_of) d
 WHERE b.outcome = '임신'
   AND b.mating_date <= d.as_of
   AND d.as_of < b.expected_farrow_date
 GROUP BY b.farm_id, d.as_of, ((d.as_of - b.mating_date) / 7) + 1;

-- ── 모돈 개체 현황 (모돈카드 대체) ───────────────────────────────────
CREATE VIEW v_sow_card AS
SELECT s.id AS sow_id, s.farm_id, s.ear_tag, s.breed, s.birth_date, s.status,
       pr.parity,
       b.mating_date, b.mating_session, b.expected_farrow_date,
       (SELECT string_agg(ml.boar_ear_tag, ' / ' ORDER BY ml.seq)
          FROM mating_line ml WHERE ml.breeding_id = b.id) AS boars,
       f.farrow_date, f.total_born, f.live_born, f.birth_weight_nominal,
       pr.weaning_date, pr.weaned_head,
       (SELECT COALESCE(SUM(CASE WHEN pt.direction = '전입' THEN pt.head_count
                                 ELSE -pt.head_count END), 0)
          FROM piglet_transfer pt WHERE pt.farrowing_id = f.id) AS foster_net,
       pr.note
  FROM sow s
  LEFT JOIN parity_record pr ON pr.sow_id = s.id
  LEFT JOIN breeding  b ON b.id = pr.breeding_id
  LEFT JOIN farrowing f ON f.id = pr.farrowing_id;

COMMENT ON VIEW v_sow_card IS
  '모돈카드를 데이터로 재현한다. foster_net 이 양수면 양자 전입 —
   이유두수 > 총산 이 되는 이유 (모돈 2589 1산: 총산 11 / 이유 12, §4.6.3)';

-- ── 체류돈·도태 후보 (△ 상태 전이, §4.6.1) ──────────────────────────
CREATE VIEW v_stayed_sow AS
SELECT s.id AS sow_id, s.farm_id, s.ear_tag, s.status, s.stayed_since,
       current_date - s.stayed_since AS stayed_days,
       CASE WHEN current_date - s.stayed_since >= 21 THEN '도태 결정 대상'
            ELSE '관찰 중' END AS action_hint,
       b.id AS breeding_id, b.mating_date, b.diagnosis_result, b.suspect_confirm_date
  FROM sow s
  LEFT JOIN LATERAL (SELECT * FROM breeding x WHERE x.sow_id = s.id
                      ORDER BY x.mating_date DESC LIMIT 1) b ON true
 WHERE s.status = '체류' AND s.stayed_since IS NOT NULL;

COMMENT ON VIEW v_stayed_sow IS
  '△ 가 토요일까지 미확정 → 체류돈 자격 획득 → 발정주기 1회전(약 21일) 후에도
   발정이 없으면 도태 결정 (9/8 회신)';

-- ── 백신 접종 예정일 (§4.6.4) ────────────────────────────────────────
CREATE VIEW v_vaccine_due AS
-- 돈군 기준 (일령 / 생후주차)
SELECT b.farm_id, vs.id AS schedule_id, v.name AS vaccine_name, vs.target,
       b.id AS batch_id, NULL::bigint AS sow_id, b.code AS subject,
       CASE vs.basis
         WHEN '일령'     THEN b.birth_date_avg + vs.offset_value
         WHEN '생후주차' THEN b.birth_date_avg + vs.offset_value * 7
       END AS due_date,
       vs.is_optional
  FROM batch b
  JOIN vaccine_schedule vs ON vs.basis IN ('일령','생후주차')
                          AND (vs.farm_id IS NULL OR vs.farm_id = b.farm_id)
                          AND vs.active
  JOIN vaccine v ON v.id = vs.vaccine_id
 WHERE b.status = 'active' AND b.birth_date_avg IS NOT NULL
UNION ALL
-- 모돈 기준 (분만 전/후 주차)
SELECT br.farm_id, vs.id, v.name, vs.target,
       NULL::bigint, br.sow_id, br.sow_ear_tag,
       br.expected_farrow_date + vs.offset_value * 7,
       vs.is_optional
  FROM breeding br
  JOIN vaccine_schedule vs ON vs.basis IN ('분만전주차','분만후주차')
                          AND (vs.farm_id IS NULL OR vs.farm_id = br.farm_id)
                          AND vs.active
  JOIN vaccine v ON v.id = vs.vaccine_id
 WHERE br.outcome = '임신';

-- 예정일이 지났는데 접종 기록이 없는 건 (L4 경고 원천)
CREATE VIEW v_vaccine_overdue AS
SELECT d.*
  FROM v_vaccine_due d
 WHERE d.due_date < current_date
   AND NOT d.is_optional
   AND NOT EXISTS (
     SELECT 1 FROM vaccination vn
      WHERE vn.schedule_id = d.schedule_id
        AND (vn.batch_id IS NOT DISTINCT FROM d.batch_id)
        AND (vn.sow_id   IS NOT DISTINCT FROM d.sow_id)
        AND vn.event_date BETWEEN d.due_date - 7 AND d.due_date + 7);

-- ── 휴약기간 현황 (§8.2 본사 화면) ───────────────────────────────────
CREATE VIEW v_withdrawal_status AS
SELECT u.farm_id, u.pen_id, p.code AS pen_code, h.name AS house_name,
       u.batch_id, u.sow_id, u.sow_ear_tag,
       m.name AS medicine_name, m.withdrawal_days,
       u.event_date, u.withdrawal_until,
       u.withdrawal_until - current_date AS days_left,
       (u.withdrawal_until > current_date) AS blocked
  FROM medicine_usage u
  JOIN medicine m ON m.id = u.medicine_id
  LEFT JOIN pen   p ON p.id = u.pen_id
  LEFT JOIN house h ON h.id = u.house_id
 WHERE u.withdrawal_until >= current_date - 7;

-- ── 본사 제출 신호등 (§5.8) ──────────────────────────────────────────
CREATE VIEW v_submission_status AS
SELECT h.farm_id, h.id AS house_id, h.name AS house_name, h.seq,
       d.report_date,
       COALESCE(dr.status::text, '미시작') AS status,
       dr.author_id, dr.submitted_at, dr.confirmed_at,
       (SELECT count(*) FROM pen p
         WHERE p.house_id = h.id
           AND p.active_from <= d.report_date
           AND (p.active_to IS NULL OR p.active_to >= d.report_date)) AS pen_total,
       (SELECT count(*) FROM pen_daily pd WHERE pd.report_id = dr.id) AS pen_entered
  FROM house h
  CROSS JOIN LATERAL (SELECT current_date AS report_date) d
  LEFT JOIN daily_report dr ON dr.house_id = h.id AND dr.report_date = d.report_date
 WHERE h.active;

-- ── KPI (§8.2) ───────────────────────────────────────────────────────
-- 생시체중은 실측이 아니므로 어떤 KPI 에도 쓰지 않는다 (C13)
CREATE VIEW v_kpi_monthly AS
WITH ym AS (
  SELECT DISTINCT farm_id, to_char(report_date, 'YYYYMM') AS year_month
    FROM pen_daily
),
farrow AS (
  SELECT farm_id, to_char(farrow_date, 'YYYYMM') AS year_month,
         count(*)                    AS litters,
         round(avg(total_born), 2)   AS avg_total_born,
         round(avg(live_born),  2)   AS avg_live_born,
         sum(stillborn)              AS stillborn,
         sum(total_born)             AS total_born
    FROM farrowing GROUP BY 1, 2
),
wean AS (
  SELECT farm_id, to_char(event_date, 'YYYYMM') AS year_month,
         sum(weaned_head)            AS weaned_total,
         round(avg(weaned_head), 2)  AS avg_weaned
    FROM weaning GROUP BY 1, 2
),
mate AS (
  SELECT farm_id, to_char(mating_date, 'YYYYMM') AS year_month,
         round(100.0 * count(*) FILTER (WHERE outcome = '임신')
               / NULLIF(count(*), 0), 2) AS conception_rate_pct
    FROM breeding GROUP BY 1, 2
),
stock AS (
  SELECT farm_id, to_char(report_date, 'YYYYMM') AS year_month,
         round(100.0 * sum(dead_head) / NULLIF(sum(opening_head), 0), 3) AS mortality_rate_pct
    FROM pen_daily GROUP BY 1, 2
),
fd AS (
  SELECT farm_id, to_char(event_date, 'YYYYMM') AS year_month,
         sum(qty_kg) AS feed_kg
    FROM feed_delivery GROUP BY 1, 2
),
sh AS (
  SELECT farm_id, to_char(ship_date, 'YYYYMM') AS year_month,
         sum(total_kg)    AS shipped_kg,
         sum(head_count)  AS shipped_head
    FROM shipment GROUP BY 1, 2
)
SELECT ym.farm_id, ym.year_month,
       farrow.litters, farrow.avg_total_born, farrow.avg_live_born,
       round(100.0 * farrow.stillborn / NULLIF(farrow.total_born, 0), 2) AS stillborn_rate_pct,
       wean.weaned_total, wean.avg_weaned,
       mate.conception_rate_pct,
       stock.mortality_rate_pct,
       fd.feed_kg, sh.shipped_kg, sh.shipped_head,
       CASE WHEN sh.shipped_kg > 0 THEN round(fd.feed_kg / sh.shipped_kg, 3) END AS fcr_approx
  FROM ym
  LEFT JOIN farrow USING (farm_id, year_month)
  LEFT JOIN wean   USING (farm_id, year_month)
  LEFT JOIN mate   USING (farm_id, year_month)
  LEFT JOIN stock  USING (farm_id, year_month)
  LEFT JOIN fd     USING (farm_id, year_month)
  LEFT JOIN sh     USING (farm_id, year_month);

COMMENT ON VIEW v_kpi_monthly IS
  'fcr_approx 는 사료 투입량 ÷ 출하 중량의 단순 근사이며 진짜 FCR(증체량 기준)이 아니다.
   품목별 급여 일령 구간이 정리되어야 정확해진다 (백로그 B6).
   생시체중은 실측이 아니므로 어떤 지표에도 쓰지 않는다 (C13)';

-- ── HACCP 월말 사육현황 (§8.3) ───────────────────────────────────────
CREATE VIEW v_haccp_monthly AS
SELECT s.farm_id, to_char(s.report_date, 'YYYYMM') AS year_month,
       s.house_type,
       sum(s.closing_head) AS head_at_month_end,
       s.report_date AS as_of
  FROM v_daily_summary s
 WHERE s.report_date = (date_trunc('month', s.report_date)
                        + interval '1 month' - interval '1 day')::date
 GROUP BY s.farm_id, to_char(s.report_date, 'YYYYMM'), s.house_type, s.report_date;
