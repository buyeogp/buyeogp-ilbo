/**
 * 일보 그리드 — 설계문서 §8.1
 *
 * 현행 엑셀 일보와 같은 행·열이다. 바뀌는 것은 「누가 계산하는가」뿐이다.
 *   · 전일두수 — 시스템 (V2). 회색·읽기전용
 *   · 당일두수 — 시스템 (V1 생성열). 여기서는 미리보기로만 계산한다
 *   · 폐사·도태 — 폐사/도태 등록에서 파생 (V7). 여기서 못 고친다
 * 팀장은 **변동분만** 넣는다.
 *
 * 빈칸을 허용하지 않는다. 「변동 없음」은 0 을 쳐서 말해야 한다 —
 * 빈칸은 「없었다」와 「아직 안 봤다」를 구별하지 못한다.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

/** 팀장이 입력하는 열. 이 순서가 곧 Tab 순서다. */
const EDIT = ['inHead', 'outHead', 'internalOutHead', 'soldHead',
              'reportedClosingHead', 'varianceReason', 'note'];
/** 매일 반드시 답해야 하는 네 칸 */
export const MOVES = ['inHead', 'outHead', 'internalOutHead', 'soldHead'];
const TEXT = new Set(['varianceReason', 'note']);

export const num = (v) => (v === '' || v == null ? 0 : Number(v));

/** 저장 전 미리보기. 실제 값은 DB 생성열이 정한다 — 어긋나면 저장 직후 드러난다. */
export function calcClosing(r) {
  return num(r.openingHead ?? r.expectedOpeningHead)
    + num(r.inHead) - num(r.outHead) - num(r.internalOutHead)
    - num(r.soldHead) - num(r.deadHead) - num(r.culledHead);
}

export function calcVariance(r) {
  if (r.reportedClosingHead === '' || r.reportedClosingHead == null) return null;
  return Number(r.reportedClosingHead) - calcClosing(r);
}

export const rowTouched  = (r) => r.filled || MOVES.some((f) => r[f] !== '' && r[f] != null);
export const rowComplete = (r) => MOVES.every((f) => r[f] !== '' && r[f] != null);

/** 행이 규칙을 어기는 지점. 셀 단위로 짚어 준다 (§6.4 P10 — 위치와 색으로 말한다) */
export function rowFaults(r) {
  const f = {};
  if (calcClosing(r) < 0) {                       // V3 — 있는 것보다 많이 나갔다
    for (const k of ['outHead', 'internalOutHead', 'soldHead']) f[k] = true;
  }
  const v = calcVariance(r);
  if (v != null && v !== 0 && !String(r.varianceReason ?? '').trim()) {
    f.varianceReason = true;                      // L4 — 차이가 나면 사유가 있어야 한다
  }
  return f;
}

const digits = (s) => s.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');

export function Grid({ rows, basis, houseName, readOnly, onChange, onRowNoChange,
                       onDeaths, photoDue }) {
  const ref = useRef(null);
  const [cur, setCur] = useState(-1);     // 커서가 있는 행 — 그 돈방을 밝힌다

  const focusCell = useCallback((r, c) => {
    const el = ref.current?.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    if (el) { el.focus(); el.select?.(); }
  }, []);

  const onKeyDown = useCallback((e, ri, ci) => {
    const key = e.key;
    const last = EDIT.length - 1;
    const go = (r, c) => { e.preventDefault(); focusCell(r, c); };

    // 한 행을 「변동 없음」으로 확정한다. 행 단위로만 둔다 —
    // 일보 전체를 한 번에 0 으로 만드는 단추는 「전날 값 복사」와 같은 물건이다 (§8.1)
    // Ctrl+0 은 크롬의 배율 초기화라 쓰지 않는다. Ctrl+Enter 는 브라우저가 안 쓴다.
    if (key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRowNoChange(ri);
      return focusCell(Math.min(ri + 1, rows.length - 1), 0);
    }

    if (key === 'Enter' || key === 'ArrowDown') {
      return go(Math.min(ri + 1, rows.length - 1), ci);
    }
    if (key === 'ArrowUp') return go(Math.max(ri - 1, 0), ci);

    // 글자 칸에서는 좌우가 커서 이동이다 — 뺏지 않는다
    if (TEXT.has(EDIT[ci])) return;

    if (key === 'ArrowRight') {
      if (ci < last) return go(ri, ci + 1);
      if (ri < rows.length - 1) return go(ri + 1, 0);
      return;
    }
    if (key === 'ArrowLeft') {
      if (ci > 0) return go(ri, ci - 1);
      if (ri > 0) return go(ri - 1, last);
    }
  }, [rows.length, focusCell, onRowNoChange]);

  // 돈방 × 축종 돈사는 돈방 이름을 한 번만 적는다 — 종이 일보와 같다
  const spans = useMemo(() => {
    if (basis !== 'pen_category') return null;
    const out = new Array(rows.length).fill(0);
    for (let i = 0; i < rows.length;) {
      let j = i;
      while (j < rows.length && rows[j].penId === rows[i].penId) j++;
      out[i] = j - i;
      i = j;
    }
    return out;
  }, [rows, basis]);

  // 돈방 묶음 번호. 분만사는 한 돈방에 4줄씩 같은 모양이 되풀이돼 옆 돈방 줄에
  // 잘못 치기 쉽다 — 묶음마다 바탕을 번갈아 칠하고 경계에 굵은 선을 긋는다
  const groups = useMemo(() => {
    const out = new Array(rows.length);
    let g = -1;
    for (let i = 0; i < rows.length; i++) {
      if (i === 0 || rows[i].penId == null || rows[i].penId !== rows[i - 1].penId) g++;
      out[i] = g;
    }
    return out;
  }, [rows]);

  const totals = useMemo(() => {
    const t = { opening: 0, inHead: 0, outHead: 0, internalOutHead: 0,
                soldHead: 0, dead: 0, closing: 0, reported: 0 };
    for (const r of rows) {
      t.opening += num(r.openingHead ?? r.expectedOpeningHead);
      for (const k of MOVES) t[k] += num(r[k]);
      t.dead += num(r.deadHead) + num(r.culledHead);
      t.closing += calcClosing(r);
      t.reported += num(r.reportedClosingHead);
    }
    return t;
  }, [rows]);

  const headCols = basis === 'pen_category' ? 2 : 1;

  const cell = (r, ri, key, ci, faults) => {
    const v = r[key] ?? '';
    const text = TEXT.has(key);

    // 못 쓰는 칸은 **못 쓰게 보여야** 한다. 입력칸 모양 그대로 두고 조용히
    // 안 받으면, 치는 사람은 자기가 뭘 잘못했는지 알 길이 없다.
    if (readOnly) {
      return (
        <td key={key} className={text ? 'readonly text' : 'readonly'}>{v}</td>
      );
    }

    return (
      <td key={key} className={faults[key] ? 'cell bad' : 'cell'}>
        <input
          data-r={ri}
          data-c={ci}
          id={`c-${ri}-${key}`}
          type="text"
          inputMode={text ? 'text' : 'numeric'}
          className={!text && v === '0' ? 'zero' : undefined}
          value={v}
          placeholder={text ? '' : '·'}
          style={text ? { textAlign: 'left' } : undefined}
          onFocus={(e) => { e.target.select(); setCur(ri); }}
          onKeyDown={(e) => onKeyDown(e, ri, ci)}
          onChange={(e) => onChange(ri, key, text ? e.target.value : digits(e.target.value))}
        />
      </td>
    );
  };

  return (
    <div className="grid-wrap" ref={ref}
         onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setCur(-1); }}>
      <table className="grid">
        {/* 숫자 칸은 폭을 못 박고, 남는 폭은 사유·비고가 가져간다.
            그러지 않으면 두수 칸이 종이 일보보다 훨씬 넓어져 한눈에 안 들어온다. */}
        <colgroup>
          <col style={{ width: 86 }} />
          {basis === 'pen_category' && <col style={{ width: 86 }} />}
          <col style={{ width: 78 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 78 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 82 }} />
          <col style={{ width: 82 }} />
          <col style={{ width: 82 }} />
          <col style={{ width: 58 }} />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th className="rowhead" rowSpan={2}>
              {basis === 'category' ? '축종구분' : basis === 'house' ? '돈사' : '돈방'}
            </th>
            {basis === 'pen_category' && <th className="rowhead" rowSpan={2}>축종</th>}
            <th rowSpan={2}>전일두수</th>
            <th className="group" colSpan={5}>변동</th>
            <th rowSpan={2}>당일두수</th>
            <th className="group" colSpan={3}>실사 검산</th>
            <th rowSpan={2}>비고</th>
          </tr>
          <tr>
            <th>전입</th><th>전출</th><th>내부이동</th><th>판매</th><th>폐사·도태</th>
            <th>보고두수</th><th>차이</th><th>사유</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r, ri) => {
            const faults = rowFaults(r);
            const closing = calcClosing(r);
            const variance = calcVariance(r);
            const missing = !readOnly && !rowComplete(r);
            const g = groups[ri];
            const here = cur >= 0 && groups[cur] === g;
            const trCls = [missing && 'missing', g % 2 && 'band',
              basis === 'pen_category' && ri > 0 && groups[ri - 1] !== g && 'pen-start',
              here && 'pen-cur', ri === cur && 'row-cur'].filter(Boolean).join(' ');
            return (
              <tr key={`${r.penId ?? 'x'}-${r.categoryId ?? 'x'}`}
                  className={trCls || undefined}>
                {(basis !== 'pen_category' || spans[ri] > 0) && (
                  <td className={here ? 'rowhead pen here' : 'rowhead pen'}
                      rowSpan={basis === 'pen_category' ? spans[ri] : 1}>
                    {r.penCode ?? r.categoryName ?? houseName}
                  </td>
                )}
                {basis === 'pen_category' && <td className="rowhead">{r.categoryName}</td>}

                <td className="readonly opening">{num(r.openingHead ?? r.expectedOpeningHead)}</td>
                {cell(r, ri, 'inHead', 0, faults)}
                {cell(r, ri, 'outHead', 1, faults)}
                {cell(r, ri, 'internalOutHead', 2, faults)}
                {cell(r, ri, 'soldHead', 3, faults)}
                {onDeaths ? (
                  // 폐사·도태는 여기서 친다 — 칸이 아니라 등록 창이다 (V7: 사유별 원장의 합)
                  <td className={photoDue?.has(`${r.penId ?? ''}|${r.categoryId ?? ''}`)
                    ? 'readonly deaths due' : 'readonly deaths'}>
                    <button type="button" className="dcell" onClick={() => onDeaths(ri)}
                            title={readOnly ? '폐사·도태 기록 보기' : '눌러서 폐사·도태 등록'}>
                      {num(r.deadHead) + num(r.culledHead)}
                    </button>
                  </td>
                ) : <td className="readonly">{num(r.deadHead) + num(r.culledHead)}</td>}
                <td className="readonly strong"
                    style={closing < 0 ? { color: 'var(--crit)', background: 'var(--crit-w)' }
                                       : undefined}>{closing}</td>
                {cell(r, ri, 'reportedClosingHead', 4, faults)}
                <td className="readonly">
                  {variance == null ? '' : (
                    <span className={variance === 0 ? 'chk ok' : 'chk bad'}>
                      {variance === 0 ? '✓' : (variance > 0 ? `+${variance}` : variance)}
                    </span>
                  )}
                </td>
                {cell(r, ri, 'varianceReason', 5, faults)}
                {cell(r, ri, 'note', 6, faults)}
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr>
            <td className="rowhead" colSpan={headCols}>합계</td>
            <td>{totals.opening}</td>
            <td>{totals.inHead}</td>
            <td>{totals.outHead}</td>
            <td>{totals.internalOutHead}</td>
            <td>{totals.soldHead}</td>
            <td>{totals.dead}</td>
            <td>{totals.closing}</td>
            <td>{totals.reported || ''}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
