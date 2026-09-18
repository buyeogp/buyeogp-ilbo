/**
 * 일보 HTML 생성 — 설계문서 §6.5 / §8.3
 *
 * 돈사마다 일보의 행 구성이 다르므로(house.count_basis) 세 가지 레이아웃을 쓴다.
 *   pen           돈방 × 돈군      자돈사 · 육성사 · 검정사 · 비육사
 *   pen_category  돈방 × 축종구분  분만1동 · 분만2동
 *   category      돈사 × 축종구분  순치사 · 종부사 · 임신1동 · 임신2동
 *
 * 열 구성과 순서는 현행 엑셀 일보를 그대로 따른다. 심사 때 위화감이 없어야 한다.
 */
import { styles } from './styles.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 두수 칸. 0 은 흐리게 — 현행 일보가 공란으로 두던 자리다 */
const n = (v) =>
  v === null || v === undefined || v === ''
    ? '<td></td>'
    : Number(v) === 0
      ? '<td class="zero">0</td>'
      : `<td>${Number(v).toLocaleString('ko-KR')}</td>`;

const td = (v, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${esc(v ?? '')}</td>`;

const KDATE = (d) => {
  if (!d) return '';
  const [y, m, dd] = String(d).split('-');
  return `${y}년 ${Number(m)}월 ${Number(dd)}일`;
};

const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

/** 돈사별 「판매」 열 이름 — 현행 일보가 돈사마다 다르게 부른다 */
const SOLD_LABEL = {
  YUKSUNG: '위탁판매<br>(외부)',
  GEOMJUNG: '종돈 분양<br>판매(외부)',
  BIYUK_M: '비육출하',
  BIYUK_F: '비육출하',
};

// ── 레이아웃 A : 돈방 × 돈군 ────────────────────────────────────────
function penLayout(rp) {
  const soldLabel = SOLD_LABEL[rp.house.code];
  const rows = rp.rows;
  const cells = (r) => [
    td(r.rowLabel, 'label'),
    td(r.entryDate),
    td(r.sexMix),
    td(r.birthDate),
    td(r.entryWeight),
    n(r.opening),
    n(r.inHead),
    n(r.outHead),
    n(r.internalOut),
    soldLabel ? n(r.sold) : '',
    n(r.dead),
    n(r.monthDead),
    n(r.closing),
    td(r.ageDays ?? r.note ?? ''),
  ].join('');

  return `
  <h2>1. 두수 현황</h2>
  <table>
    <colgroup>
      <col class="w-lbl"><col class="w-date"><col class="w-sex"><col class="w-date">
      <col class="w-num2"><col class="w-num"><col class="w-num"><col class="w-num">
      <col class="w-num">${soldLabel ? '<col class="w-num">' : ''}
      <col class="w-num2"><col class="w-num2"><col class="w-num"><col class="w-txt">
    </colgroup>
    <thead><tr>
      <th>구분</th><th>입식일</th><th>암 · 수</th><th>평균<br>생일</th><th>전입<br>체중</th>
      <th>전일<br>두수</th><th>전 입</th><th>전 출</th><th>내부 전출<br>(돈방 이동)</th>
      ${soldLabel ? `<th>${soldLabel}</th>` : ''}
      <th>당 일<br>폐 사</th><th>월 계<br>폐 사</th><th>당 일<br>두 수</th>
      <th>${rp.house.code === 'JADON' ? '비고' : '일령'}</th>
    </tr></thead>
    <tbody>
      ${rows.map((r) => `<tr>${cells(r)}</tr>`).join('\n      ')}
      <tr class="sum">
        <td colspan="5">합 계 두 수</td>
        ${n(sum(rows, 'opening'))}${n(sum(rows, 'inHead'))}${n(sum(rows, 'outHead'))}
        ${n(sum(rows, 'internalOut'))}${soldLabel ? n(sum(rows, 'sold')) : ''}
        ${n(sum(rows, 'dead'))}${n(sum(rows, 'monthDead'))}${n(sum(rows, 'closing'))}
        <td></td>
      </tr>
    </tbody>
  </table>`;
}

// ── 레이아웃 B : 돈사 × 축종구분 ────────────────────────────────────
function categoryLayout(rp) {
  const groups = [];
  for (const r of rp.rows) {
    let g = groups.find((x) => x.house === r.houseName);
    if (!g) groups.push((g = { house: r.houseName, items: [] }));
    g.items.push(r);
  }
  const line = (r, first, span) => `<tr>
      ${first ? `<td class="label" rowspan="${span + 1}">${esc(r.houseName)}</td>` : ''}
      ${td(r.categoryName, 'label')}
      ${n(r.opening)}${n(r.inHead)}${n(r.outHead)}
      ${n(r.recurred)}${n(r.aborted)}${n(r.infertile)}
      ${n(r.sold)}${n(r.dead)}${n(r.closing)}
      ${n(r.matedDay)}${n(r.matedWeek)}
    </tr>`;

  const all = rp.rows;
  return `
  <h2>1. 두수 현황</h2>
  <table>
    <colgroup>
      <col class="w-lbl"><col style="width:22mm"><col class="w-num"><col class="w-num">
      <col class="w-num"><col class="w-num2"><col class="w-num2"><col class="w-num2">
      <col class="w-num2"><col class="w-num2"><col class="w-num">
      <col class="w-num2"><col class="w-num2">
    </colgroup>
    <thead>
      <tr>
        <th colspan="2">구분</th><th rowspan="2">전일<br>두수</th>
        <th rowspan="2">전 입</th><th rowspan="2">전 출</th>
        <th colspan="3">사고 내역</th>
        <th rowspan="2">판매</th><th rowspan="2">폐사</th>
        <th rowspan="2">당 일<br>두 수</th><th colspan="2">종 부</th>
      </tr>
      <tr>
        <th>돈사</th><th>축종구분</th>
        <th>재발</th><th>유산</th><th>불임</th>
        <th>당일<br>종부</th><th>주계<br>종부</th>
      </tr>
    </thead>
    <tbody>
      ${groups.map((g) => g.items.map((r, i) => {
        const row = line(r, i === 0, g.items.length);
        if (i < g.items.length - 1) return row;
        return row + `
    <tr class="sum">
      <td class="label">계</td>
      ${n(sum(g.items, 'opening'))}${n(sum(g.items, 'inHead'))}${n(sum(g.items, 'outHead'))}
      ${n(sum(g.items, 'recurred'))}${n(sum(g.items, 'aborted'))}${n(sum(g.items, 'infertile'))}
      ${n(sum(g.items, 'sold'))}${n(sum(g.items, 'dead'))}${n(sum(g.items, 'closing'))}
      <td></td><td></td>
    </tr>`;
      }).join('\n      ')).join('\n      ')}
      <tr class="sum">
        <td colspan="2">합 계</td>
        ${n(sum(all, 'opening'))}${n(sum(all, 'inHead'))}${n(sum(all, 'outHead'))}
        ${n(sum(all, 'recurred'))}${n(sum(all, 'aborted'))}${n(sum(all, 'infertile'))}
        ${n(sum(all, 'sold'))}${n(sum(all, 'dead'))}${n(sum(all, 'closing'))}
        <td></td><td></td>
      </tr>
    </tbody>
  </table>`;
}

// ── 레이아웃 C : 돈방 × 축종구분 (분만사) ───────────────────────────
function penCategoryLayout(rp) {
  // 돈방 하나가 한 행, 축종구분은 열로 편다 — 현행 분만사일보 그대로
  const byPen = new Map();
  for (const r of rp.rows) {
    if (!byPen.has(r.penCode)) byPen.set(r.penCode, { penCode: r.penCode, entryDate: r.entryDate });
    byPen.get(r.penCode)[r.categoryCode] = r;
  }
  const pens = [...byPen.values()];
  const g = (p, cat, k) => (p[cat] ? p[cat][k] : null);
  const tot = (cat, k) => pens.reduce((a, p) => a + (Number(g(p, cat, k)) || 0), 0);

  const row = (p) => `<tr>
      ${td(p.penCode, 'label')}${td(p.entryDate)}
      ${n(g(p, 'FARROW_WAIT', 'opening'))}${n(g(p, 'LACT_SOW', 'opening'))}
      ${n(g(p, 'SUCK', 'opening'))}${n(g(p, 'WEANED', 'opening'))}
      ${n(g(p, 'FARROW_WAIT', 'inHead'))}${n(g(p, 'FARROW_WAIT', 'outHead'))}
      ${n(g(p, 'LACT_SOW', 'inHead'))}${n(g(p, 'LACT_SOW', 'outHead'))}
      ${n(g(p, 'SUCK', 'inHead'))}${n(g(p, 'SUCK', 'outHead'))}
      ${n(g(p, 'FARROW_WAIT', 'dead'))}${n(g(p, 'LACT_SOW', 'dead'))}${n(g(p, 'SUCK', 'dead'))}
      ${n(g(p, 'FARROW_WAIT', 'closing'))}${n(g(p, 'LACT_SOW', 'closing'))}
      ${n(g(p, 'SUCK', 'closing'))}
      ${n(g(p, 'FARROW_WAIT', 'internalOut'))}
    </tr>`;

  return `
  <h2>1. 두수 현황</h2>
  <table>
    <colgroup>
      <col class="w-lbl"><col class="w-date">
      <col class="w-num2"><col class="w-num2"><col class="w-num"><col class="w-num2">
      <col class="w-num2"><col class="w-num2"><col class="w-num2"><col class="w-num2">
      <col class="w-num2"><col class="w-num2">
      <col class="w-num2"><col class="w-num2"><col class="w-num2">
      <col class="w-num2"><col class="w-num2"><col class="w-num"><col class="w-num2">
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2">구분</th><th rowspan="2">입식일</th>
        <th colspan="4">전일두수</th>
        <th colspan="2">대기모돈</th><th colspan="2">포유모돈</th><th colspan="2">포유자돈</th>
        <th colspan="3">폐사</th><th colspan="3">당일두수</th>
        <th rowspan="2">분만<br>복수</th>
      </tr>
      <tr>
        <th>분만<br>대기돈</th><th>포유<br>모돈</th><th>포유<br>자돈</th><th>이유<br>자돈</th>
        <th>전입</th><th>전출</th><th>전입</th><th>전출</th><th>전입</th><th>전출</th>
        <th>대기<br>모돈</th><th>포유<br>모돈</th><th>포자</th>
        <th>분만<br>대기돈</th><th>포유<br>모돈</th><th>포유<br>자돈</th>
      </tr>
    </thead>
    <tbody>
      ${pens.map(row).join('\n      ')}
      <tr class="sum">
        <td colspan="2">${esc(rp.house.name)} 합계</td>
        ${n(tot('FARROW_WAIT', 'opening'))}${n(tot('LACT_SOW', 'opening'))}
        ${n(tot('SUCK', 'opening'))}${n(tot('WEANED', 'opening'))}
        ${n(tot('FARROW_WAIT', 'inHead'))}${n(tot('FARROW_WAIT', 'outHead'))}
        ${n(tot('LACT_SOW', 'inHead'))}${n(tot('LACT_SOW', 'outHead'))}
        ${n(tot('SUCK', 'inHead'))}${n(tot('SUCK', 'outHead'))}
        ${n(tot('FARROW_WAIT', 'dead'))}${n(tot('LACT_SOW', 'dead'))}${n(tot('SUCK', 'dead'))}
        ${n(tot('FARROW_WAIT', 'closing'))}${n(tot('LACT_SOW', 'closing'))}
        ${n(tot('SUCK', 'closing'))}
        ${n(tot('FARROW_WAIT', 'internalOut'))}
      </tr>
    </tbody>
  </table>`;
}

const LAYOUT = {
  pen: penLayout,
  category: categoryLayout,
  pen_category: penCategoryLayout,
  house: penLayout,
};

/** 백신 접종 기록부 — 현행 일보에 있는 빈 표. 출력물에도 그대로 둔다 */
function vaccineBlock(rp) {
  const rows = rp.vaccinations ?? [];
  const blank = Math.max(0, 4 - rows.length);
  return `
  <h2>2. 백신 접종 기록부</h2>
  <table>
    <colgroup><col class="w-lbl"><col class="w-num2"><col style="width:auto">
      <col style="width:22mm"><col style="width:45mm"></colgroup>
    <thead><tr><th>돈방</th><th>두 수</th><th>백신 · 약품명</th>
      <th>투여량<br>(cc)</th><th>비고</th></tr></thead>
    <tbody>
      ${rows.map((v) => `<tr>${td(v.penCode, 'label')}${n(v.headCount)}
        ${td(v.vaccineName, 'txt')}${td(v.dose)}${td(v.note, 'txt')}</tr>`).join('\n      ')}
      ${Array.from({ length: blank },
        () => '<tr><td></td><td></td><td></td><td></td><td></td></tr>').join('\n      ')}
    </tbody>
  </table>`;
}

export function renderDailyReport(rp) {
  const layout = LAYOUT[rp.house.countBasis] ?? penLayout;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>${esc(rp.house.name)} 일지 ${esc(rp.reportDate)}</title>
<style>${styles}</style></head>
<body><div class="sheet">

  <div class="hd">
    <div>
      <p class="farm">${esc(rp.farm)}</p>
      <h1>${esc(rp.house.name)} 일지</h1>
    </div>
    <div class="date">${KDATE(rp.reportDate)}</div>
  </div>

  <div class="subhd">
    <div class="who">
      <span>작성자 <b>${esc(rp.author ?? '')}</b></span>
      ${rp.fieldWriter ? `<span>현장 기록 <b>${esc(rp.fieldWriter)}</b></span>` : ''}
      <span>확인자 <b>${esc(rp.confirmedBy ?? '')}</b></span>
    </div>
    <div>일보번호 ${esc(rp.reportNo ?? '—')}</div>
  </div>

  ${layout(rp)}

  <h2>◈ 특이 사항</h2>
  <div class="note-box">${esc(rp.noteText ?? '')}</div>

  ${vaccineBlock(rp)}

  <div class="sign">
    <div class="slot"><span>작성자</span><i>(인)</i></div>
    <div class="slot"><span>확인자</span><i>(인)</i></div>
  </div>

  <div class="foot">
    <div>부여GP 돈사 일보 시스템 · 출력 ${esc(rp.printedAt ?? '')}</div>
    <div class="hash">무결성 ${esc((rp.contentHash ?? '').slice(0, 32))}</div>
  </div>

</div></body></html>`;
}
