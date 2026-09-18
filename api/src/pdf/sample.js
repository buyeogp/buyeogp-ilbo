/**
 * 샘플 데이터 — 판독한 실제 일보에서 뽑는다.
 *
 * 가짜 숫자로 레이아웃을 맞추면 실제로 맞는지 알 수 없다.
 * db/migration/m3_pen_daily.csv (현행 엑셀 판독본)에서 그대로 읽어
 * 출력물을 원본 엑셀과 눈으로 대조할 수 있게 한다.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.resolve(HERE, '../../../db/migration/m3_pen_daily.csv');

const HOUSE_NAME = {
  SUNCHI: '순치사', JONGBU: '종부사', IMSIN1: '임신1동', IMSIN2: '임신2동',
  BUNMAN1: '분만1동', BUNMAN2: '분만2동', JADON: '자돈사', YUKSUNG: '육성사',
  GEOMJUNG: '검정사', BIYUK_M: '비육사(수)', BIYUK_F: '비육사(암)', GYERYU: '계류장',
};
const CAT_NAME = {
  CAND_M: '후보(수)', CAND_F: '후보(암)', BOAR: '웅돈', WEAN_SOW: '이유모돈',
  WEAN_PIG: '이유돈', STAY: '체류돈', STAY_S: '단기체류', STAY_L: '장기체류',
  PREG: '임신돈', FARROW_WAIT: '분만대기돈', LACT_SOW: '포유모돈',
  SUCK: '포유자돈', WEANED: '이유자돈',
};
const BASIS = {
  SUNCHI: 'category', JONGBU: 'category', IMSIN1: 'category', IMSIN2: 'category',
  BUNMAN1: 'pen_category', BUNMAN2: 'pen_category', GYERYU: 'house',
};
// 종부 임신사 일지는 네 돈사를 한 장에 싣는다
const JONGBU_SHEET = ['SUNCHI', 'JONGBU', 'IMSIN1', 'IMSIN2'];
// 축종구분 행 순서 — 현행 일보 그대로 (016_seed_pen.sql 의 house_category.seq)
const CAT_ORDER = {
  SUNCHI: ['CAND_M', 'CAND_F', 'WEAN_SOW', 'STAY', 'PREG'],
  JONGBU: ['BOAR', 'CAND_F', 'WEAN_PIG', 'STAY_S', 'STAY_L', 'PREG'],
  IMSIN1: ['CAND_F', 'STAY_S', 'PREG'],
  IMSIN2: ['CAND_F', 'STAY_S', 'PREG'],
  BUNMAN1: ['FARROW_WAIT', 'LACT_SOW', 'SUCK', 'WEANED'],
  BUNMAN2: ['FARROW_WAIT', 'LACT_SOW', 'SUCK', 'WEANED'],
};

function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l) => {
    const v = l.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
  });
}

const penSort = (a, b) => {
  const pa = (a.penCode || '').split('-').map(Number);
  const pb = (b.penCode || '').split('-').map(Number);
  return (pa[0] - pb[0]) || (pa[1] - pb[1]);
};

export async function buildSamples(reportDate = '2026-08-18') {
  const rows = parseCsv(await readFile(CSV, 'utf8')).filter(
    (r) => r.report_date === reportDate);

  const shape = (r) => {
    const opening = +r.opening_head, inH = +r.in_head, out = +r.out_head;
    const io = +r.internal_out_head, sold = +r.sold_head, dead = +r.dead_head;
    return {
      penCode: r.pen_code,
      categoryCode: r.category_code,
      categoryName: CAT_NAME[r.category_code] ?? '',
      houseName: HOUSE_NAME[r.house_code],
      rowLabel: r.pen_code || CAT_NAME[r.category_code] || HOUSE_NAME[r.house_code],
      entryDate: r.entry_date ? r.entry_date.slice(5) : '',
      birthDate: r.birth_date_avg ? r.birth_date_avg.slice(5) : '',
      entryWeight: r.entry_weight,
      sexMix: r.sex_mix,
      opening, inHead: inH, outHead: out, internalOut: io, sold, dead,
      recurred: +r.recurred_head || 0,
      aborted: +r.aborted_head || 0,
      infertile: +r.infertile_head || 0,
      monthDead: null,
      // 시스템 계산값을 쓴다 — 엑셀 기재값이 아니다 (설계문서 P5 / V1)
      closing: opening + inH - out - io - sold - dead,
      note: r.note,
    };
  };

  const byHouse = new Map();
  for (const r of rows) {
    if (!byHouse.has(r.house_code)) byHouse.set(r.house_code, []);
    byHouse.get(r.house_code).push(shape(r));
  }
  // 축종구분 행은 현행 일보의 순서를 따른다 — 심사 때 순서가 달라 보이면 안 된다
  for (const [code, list] of byHouse) {
    const order = CAT_ORDER[code];
    if (order) list.sort((a, b) => order.indexOf(a.categoryCode) - order.indexOf(b.categoryCode));
  }

  const samples = {};
  for (const [code, list] of byHouse) {
    if (JONGBU_SHEET.includes(code)) continue;
    samples[code] = {
      farm: '농업회사법인 (주) 부여지피',
      house: { code, name: HOUSE_NAME[code], countBasis: BASIS[code] ?? 'pen' },
      reportDate,
      author: { JADON: '라주', YUKSUNG: '펨바', GEOMJUNG: '펨바',
                BIYUK_M: '펨바', BUNMAN1: '햄', BUNMAN2: '햄' }[code] ?? '',
      confirmedBy: '',
      reportNo: `${reportDate.replace(/-/g, '')}-${code}`,
      rows: CAT_ORDER[code] && !list[0]?.penCode ? list : list.sort(penSort),
      noteText: '',
      vaccinations: [],
    };
  }

  // 종부 임신사 — 순치사 · 종부사 · 임신1동 · 임신2동을 한 장에
  const jongbu = JONGBU_SHEET.flatMap((c) => byHouse.get(c) ?? []);
  if (jongbu.length) {
    samples.JONGBU_SHEET = {
      farm: '농업회사법인 (주) 부여지피',
      house: { code: 'JONGBU_SHEET', name: '종부 임신사', countBasis: 'category' },
      reportDate,
      author: '배두',
      confirmedBy: '',
      reportNo: `${reportDate.replace(/-/g, '')}-JONGBU`,
      rows: jongbu,
      noteText: '',
      vaccinations: [],
    };
  }
  return samples;
}
