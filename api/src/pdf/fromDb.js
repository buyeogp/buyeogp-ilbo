/**
 * 일보 한 건을 PDF 양식(layout.js)이 받는 모양으로 DB 에서 읽는다 — 설계문서 §6.5
 *
 * sample.js 는 과거 엑셀 판독본(CSV)에서 같은 모양을 만든다. 양식은 둘을 구분하지 않는다.
 * 숫자는 전부 시스템 값이다 — 당일두수는 생성열(V1), 폐사·도태는 원장의 합(V7).
 *
 * 「폐사」 열 = 폐사 + 도태. 현행 일보에 도태 열이 따로 없고, 당일두수 식이
 * 둘을 함께 빼므로 합쳐야 종이 위에서 가로 셈이 맞는다.
 */

const FARM_NAME = '농업회사법인 (주) 부여지피';

const md = (d) => (d ? String(d).slice(5) : '');

/** @param q  tx() 의 질의 함수 (RLS 가 걸린 연결) */
export async function reportFromDb(q, reportId) {
  const rep = await q.one(
    `SELECT dr.id, dr.status::text, dr.report_date::text AS d, dr.note_text,
            h.id AS house_id, h.code, h.name, h.count_basis::text AS basis,
            a.name AS author, c.name AS confirmer
       FROM app.daily_report dr
       JOIN app.house h ON h.id = dr.house_id
       LEFT JOIN sec.app_user a ON a.id = dr.author_id
       LEFT JOIN sec.app_user c ON c.id = dr.confirmed_by
      WHERE dr.id = $1`, [reportId]);
  if (!rep) return null;

  const rows = await q.all(
    `SELECT pd.pen_id, pd.category_id, p.code AS pen_code, p.seq AS pen_seq,
            pc.code AS cat_code, pc.name AS cat_name, hc.seq AS cat_seq,
            pd.opening_head, pd.in_head, pd.out_head, pd.internal_out_head, pd.sold_head,
            pd.dead_head + pd.culled_head AS dead, pd.closing_head, pd.note,
            b.entry_date::text AS entry_date, b.birth_date_avg::text AS birth_date,
            b.entry_weight_avg, b.sex_mix::text AS sex_mix,
            -- 월계 폐사: 그 달 1일부터 이 날까지, 같은 줄(돈방 × 축종)의 폐사 + 도태
            (SELECT COALESCE(SUM(x.dead_head + x.culled_head), 0)
               FROM app.pen_daily x
              WHERE x.house_id = pd.house_id
                AND x.pen_id IS NOT DISTINCT FROM pd.pen_id
                AND x.category_id IS NOT DISTINCT FROM pd.category_id
                AND x.report_date >= date_trunc('month', pd.report_date)::date
                AND x.report_date <= pd.report_date)::int AS month_dead,
            CASE WHEN b.birth_date_avg IS NOT NULL
                 THEN pd.report_date - b.birth_date_avg END AS age_days
       FROM app.pen_daily pd
       LEFT JOIN app.pen p ON p.id = pd.pen_id
       LEFT JOIN app.pig_category pc ON pc.id = pd.category_id
       LEFT JOIN app.house_category hc ON hc.house_id = pd.house_id AND hc.category_id = pd.category_id
       LEFT JOIN app.batch b ON b.id = pd.batch_id
      WHERE pd.report_id = $1
      ORDER BY p.seq NULLS FIRST, hc.seq NULLS FIRST`, [reportId]);

  return {
    farm: FARM_NAME,
    house: { code: rep.code, name: rep.name, countBasis: rep.basis },
    reportDate: rep.d,
    status: rep.status,
    author: rep.author ?? '',
    confirmedBy: rep.confirmer ?? '',
    reportNo: `${rep.d.replace(/-/g, '')}-${rep.code}`,
    noteText: rep.note_text ?? '',
    vaccinations: [],
    rows: rows.map((r) => ({
      penCode: r.pen_code ?? '',
      categoryCode: r.cat_code ?? '',
      categoryName: r.cat_name ?? '',
      houseName: rep.name,
      rowLabel: r.pen_code ?? r.cat_name ?? rep.name,
      entryDate: md(r.entry_date),
      birthDate: md(r.birth_date),
      entryWeight: r.entry_weight_avg ?? '',
      sexMix: r.sex_mix ?? '',          // enum 이 이미 한국어다 (암 · 수 · 암수)
      opening: r.opening_head,
      inHead: r.in_head,
      outHead: r.out_head,
      internalOut: r.internal_out_head,
      sold: r.sold_head,
      dead: r.dead,
      monthDead: r.month_dead,
      closing: r.closing_head,
      ageDays: r.age_days ?? null,
      note: r.note ?? '',
      // 종부·임신사 사고 내역·종부 — 아직 입력 화면이 없다. 칸은 비워 둔다
      recurred: null, aborted: null, infertile: null, matedDay: null, matedWeek: null,
    })),
  };
}

/**
 * 종부 임신사 일지 — 순치사 · 종부사 · 임신1동 · 임신2동을 한 장에 (현행 엑셀 양식).
 * 네 돈사는 한 팀장이 함께 쓰고 종이도 한 장으로 철한다. 양식(categoryLayout)이
 * 돈사 이름으로 묶어 돈사별 소계와 전체 합계를 낸다.
 * 무결성 값이 돈사끼리 섞이지 않게 줄마다 돈사 코드를 붙인다.
 */
export const JONGBU_SHEET = ['SUNCHI', 'JONGBU', 'IMSIN1', 'IMSIN2'];

export function combineJongbu(parts) {
  const uniq = (xs) => [...new Set(xs.filter(Boolean))].join(' · ');
  const first = parts[0];
  return {
    farm: first.farm,
    house: { code: 'JONGBU_SHEET', name: '종부 임신사', countBasis: 'category' },
    reportDate: first.reportDate,
    status: first.status,
    author: uniq(parts.map((p) => p.author)),
    confirmedBy: uniq(parts.map((p) => p.confirmedBy)),
    reportNo: `${first.reportDate.replace(/-/g, '')}-JONGBU`,
    noteText: parts.filter((p) => p.noteText).map((p) => `[${p.house.name}] ${p.noteText}`).join('\n'),
    vaccinations: [],
    rows: parts.flatMap((p) => p.rows.map((r) => ({ ...r, penCode: p.house.code }))),
  };
}
