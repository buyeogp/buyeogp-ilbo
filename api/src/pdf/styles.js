/**
 * 일보 출력물 스타일 — 설계문서 §6.5
 *
 * HACCP 전자기록이 인정되지 않으므로 시스템이 종이를 만들어야 한다.
 * 심사 때 위화감이 없도록 현행 엑셀 일보의 선·간격·글자 크기를 그대로 따른다.
 * 화면용이 아니라 인쇄용이므로 mm 단위로 짠다.
 */
export const styles = `
@page {
  size: A4 landscape;
  margin: 8mm 7mm;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: "Malgun Gothic", "맑은 고딕", "Noto Sans KR", sans-serif;
  font-size: 8pt;
  line-height: 1.25;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.sheet { page-break-after: always; }
.sheet:last-child { page-break-after: auto; }

/* ── 머리글 ─────────────────────────────────────── */
.hd {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  border-bottom: 0.6mm solid #000;
  padding-bottom: 1.2mm;
  margin-bottom: 1.5mm;
}
.hd h1 {
  font-size: 13pt;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.2mm;
}
.hd .farm { font-size: 7.5pt; margin: 0 0 0.6mm; }
.hd .date { font-size: 11pt; font-weight: 700; font-variant-numeric: tabular-nums; }

.subhd {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 1.2mm;
  font-size: 7.5pt;
}
.subhd .who span { margin-right: 6mm; }
.subhd .who b { font-weight: 600; }

h2 {
  font-size: 8.5pt;
  font-weight: 700;
  margin: 3mm 0 1mm;
  padding-left: 0.8mm;
  border-left: 1mm solid #000;
}

/* ── 표 ─────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
th, td {
  border: 0.18mm solid #000;
  padding: 0.7mm 0.8mm;
  text-align: center;
  vertical-align: middle;
  overflow: hidden;
  white-space: nowrap;
}
th {
  background: #EDEDED;
  font-weight: 600;
  font-size: 7pt;
  line-height: 1.15;
}
td { font-variant-numeric: tabular-nums; height: 4.6mm; }
td.label { font-weight: 600; background: #F7F7F7; }
td.txt { text-align: left; white-space: normal; }
td.zero { color: #9A9A9A; }
tr.sum td { font-weight: 700; background: #E4E4E4; }
tr.group td.label { background: #EDEDED; }

/* A4 가로 인쇄폭 283mm 에 맞춘 열 너비.
   합이 인쇄폭에 가깝지 않으면 브라우저가 남는 폭을 비례 배분해
   비고 열만 비정상적으로 넓어진다 */
col.w-lbl  { width: 18mm; }
col.w-date { width: 22mm; }
col.w-sex  { width: 13mm; }
col.w-num  { width: 19mm; }
col.w-num2 { width: 17mm; }
col.w-txt  { width: 40mm; }

/* ── 특이사항 ───────────────────────────────────── */
.note-box {
  border: 0.18mm solid #000;
  min-height: 11mm;
  padding: 1.2mm;
  font-size: 7.5pt;
  white-space: pre-wrap;
  text-align: left;
  line-height: 1.45;
}

/* ── 서명란 ─────────────────────────────────────── */
.sign {
  display: flex;
  justify-content: flex-end;
  gap: 4mm;
  margin-top: 3mm;
}
.sign .slot {
  border: 0.18mm solid #000;
  width: 42mm;
  height: 13mm;
  position: relative;
}
.sign .slot span {
  position: absolute;
  top: 0.8mm; left: 1mm;
  font-size: 6.5pt;
  font-weight: 600;
}
.sign .slot i {
  position: absolute;
  right: 2mm; bottom: 1.2mm;
  font-style: normal;
  font-size: 7pt;
  color: #555;
}

/* ── 발자국 (출력물 == 시스템 데이터 증명) ──────── */
.foot {
  margin-top: 2.5mm;
  padding-top: 1.2mm;
  border-top: 0.18mm solid #999;
  display: flex;
  justify-content: space-between;
  font-size: 6pt;
  color: #444;
  font-variant-numeric: tabular-nums;
}
.foot .hash { font-family: "Consolas", monospace; letter-spacing: -0.02em; }
`;
