/**
 * 종부·임신 파트 — 순치사 · 종부사 · 임신1동 · 임신2동을 한 페이지에 (발주처 요구 2026-10-13)
 *
 * 종이 파트일보처럼 네 돈사를 위에서 아래로 잇는다. 돼지가 네 돈사 사이를 자주 오가서
 * 돈사마다 화면을 넘기면 전출·전입을 맞춰 보기 어렵다.
 *
 * DB 에서는 지금처럼 돈사별 일보 4건이다(제출 현황·확정·PDF 그대로). 이 화면이 더하는 것은
 *   · 위쪽 합계표 — 네 돈사의 전일·전입·전출·…·당일을 한눈에
 *   · 「네 돈사 한 번에 제출」 — 한 트랜잭션이라 하나라도 걸리면 아무것도 제출되지 않는다
 * 확정·되돌려 보내기·제출 취소는 돈사마다 한다(각 칸의 단추).
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, formatDate, STATUS_LABEL } from '../api.js';
import { DailyReport } from './DailyReport.jsx';
import { DateNav } from '../components/DateNav.jsx';

/** 파트 정의. 코드 순서 = 종이 순서 */
export const PARTS = {
  jongbu: { name: '종부·임신 파트', codes: ['SUNCHI', 'JONGBU', 'IMSIN1', 'IMSIN2'] },
};

export function PartReport({ me, part, date, houses, onChanged }) {
  const nav = useNavigate();
  const def = PARTS[part];
  // 볼 수 있는 돈사만 (houses 는 위쪽 탭과 같은 목록 — 권한으로 이미 걸러져 있다)
  const members = useMemo(() => (def ? def.codes
    .map((c) => houses.find((h) => h.code === c)).filter(Boolean) : []), [def, houses]);

  const [st, setSt] = useState({});            // houseId → DailyReport 가 알려 준 상태
  const report = useCallback((houseId, s) => {
    setSt((old) => ({ ...old, [houseId]: s }));
  }, []);
  const [tick, setTick] = useState(0);
  const [ask, setAsk] = useState(null);         // 'submit'
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);

  if (!def) return <div className="center">없는 파트입니다.</div>;
  if (!members.length) return <div className="center">불러오는 중…</div>;

  const list = members.map((h) => ({ h, s: st[h.houseId] }));
  const loaded = list.every((x) => x.s?.loaded);

  // 「한 번에 제출」 대상 = 작성 중인 일보. 시작 안 한 돈사가 있으면 막는다(빠진 돈사를 모르고 지나치지 않게)
  const drafts = list.filter((x) => x.s?.status === 'draft');
  const notStarted = list.filter((x) => x.s?.loaded && !x.s.status);
  const blockers = [];
  for (const x of notStarted) blockers.push(`${x.h.name} — 아직 시작하지 않았습니다`);
  for (const x of drafts) {
    if (!x.s.canWrite) blockers.push(`${x.h.name} — 담당 돈사가 아닙니다`);
    else if (!x.s.editable) blockers.push(`${x.h.name} — 이 화면에서는 입력할 수 없습니다(좁은 화면)`);
    if (x.s.missing) blockers.push(`${x.h.name} — 빈 줄 ${x.s.missing}`);
    if (x.s.faulty) blockers.push(`${x.h.name} — 고칠 칸이 있는 줄 ${x.s.faulty}`);
  }
  const canSubmitAll = loaded && drafts.length > 0 && blockers.length === 0;
  const canStart = list.some((x) => x.s?.loaded && !x.s.status && x.s.canWrite);

  const startAll = async () => {
    setBusy('open'); setErr(null);
    try {
      for (const x of list) {
        if (x.s?.loaded && !x.s.status && x.s.canWrite) await api.open(x.h.houseId, date);
      }
      setTick((t) => t + 1);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '일보를 시작하지 못했습니다.');
      setTick((t) => t + 1);
    } finally { setBusy(null); }
  };

  const submitAll = async () => {
    setBusy('submit'); setErr(null); setInfo(null);
    try {
      for (const x of drafts) if (x.s.dirty) await x.s.save();    // 치던 것부터 저장
      const r = await api.submitMany(drafts.map((x) => x.s.reportId));
      setInfo(`${r.submitted.map((x) => x.houseName).join(' · ')} 제출했습니다.`);
      setTick((t) => t + 1);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError ? `제출하지 못했습니다 (아무것도 제출되지 않았습니다) — ${e.message}`
        : '제출하지 못했습니다.');
    } finally { setBusy(null); }
  };

  const goTo = (d) => { if (d !== date) nav(`/part/${part}/${d}`); };
  const jump = (houseId) => document.getElementById(`part-house-${houseId}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const total = (k) => list.reduce((a, x) => a + (x.s?.sums?.[k] ?? 0), 0);
  const COLS = [['opening', '전일'], ['in', '전입'], ['out', '전출'], ['internal', '내부이동'],
    ['sold', '판매'], ['dead', '폐사·도태'], ['closing', '당일']];

  return (
    <div className="part-page">
      <div className="house-banner">
        <h1>{def.name}</h1>
        <span className="date">{formatDate(date)}</span>
        <span className="hint">{members.map((h) => h.name).join(' · ')}</span>
        <span className="spacer" />
        <DateNav date={date} onGo={goTo} />
      </div>

      {/* 합계표 — 네 돈사를 한눈에. 이름을 누르면 그 돈사로 내려간다 */}
      <div className="grid-wrap fit part-sum">
        <table className="k part-sum-table">
          <thead>
            <tr>
              <th>돈사</th><th>상태</th>
              {COLS.map(([k, t]) => <th key={k}>{t}</th>)}
              <th>남은 일</th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ h, s }) => {
              const todo = [];
              if (s?.status === 'draft' && s.missing) todo.push(`빈 줄 ${s.missing}`);
              if (s?.status === 'draft' && s.faulty) todo.push(`고칠 줄 ${s.faulty}`);
              if (s?.photoDue) todo.push(`사진 보완 ${s.photoDue}`);
              return (
                <tr key={h.houseId}>
                  <td><button type="button" className="linklike" onClick={() => jump(h.houseId)}>{h.name}</button></td>
                  <td><span className={'badge ' + (s?.status ?? 'none')}>{STATUS_LABEL[s?.status] ?? '미시작'}</span></td>
                  {COLS.map(([k]) => <td key={k} className="num">{s?.sums ? s.sums[k] : ''}</td>)}
                  <td className={todo.length ? 'dl-due' : 'dim'}>{todo.join(' · ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}>파트 합계</th>
              {COLS.map(([k]) => <th key={k} className="num">{loaded ? total(k) : ''}</th>)}
              <th />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="actionbar part-actions">
        <span className="hint">
          위 합계에서 돈사끼리 옮긴 두수(전출 ↔ 전입)를 맞춰 볼 수 있습니다. 확정·되돌려 보내기는 돈사마다 아래에서 합니다.
        </span>
        <span className="spacer" />
        {canStart && (
          <button className="btn" onClick={startAll} disabled={busy != null}>
            {busy === 'open' ? '시작하는 중…' : '시작 안 한 돈사 모두 시작'}
          </button>
        )}
        {drafts.length > 0 && (ask === 'submit' ? (
          <span className="inline-confirm">
            <b>{drafts.map((x) => x.h.name).join(' · ')}</b> 를 한 번에 제출합니다. 하나라도 걸리면 아무것도 제출되지 않습니다.
            <button className="btn small" onClick={() => setAsk(null)}>다시 보기</button>
            <button className="btn small primary" disabled={busy != null}
                    onClick={() => { setAsk(null); submitAll(); }}>제출합니다</button>
          </span>
        ) : (
          <button className="btn primary" onClick={() => setAsk('submit')}
                  disabled={busy != null || !canSubmitAll}
                  title={blockers.length ? blockers.join('\n') : ''}>
            {busy === 'submit' ? '제출 중…' : `${drafts.length === list.length ? '네 돈사' : `${drafts.length}개 돈사`} 한 번에 제출`}
          </button>
        ))}
      </div>

      {loaded && drafts.length > 0 && blockers.length > 0 && (
        <div className="notes">
          {blockers.map((b) => <div key={b} className="note warn"><span className="where">제출 전</span><span>{b}</span></div>)}
        </div>
      )}
      {err && <div className="notes"><div className="note block">{err}</div></div>}
      {info && <div className="notes"><div className="note info"><span>{info}</span></div></div>}

      {members.map((h) => (
        <DailyReport key={`${h.houseId}-${date}`} me={me} houseId={h.houseId} date={date}
                     onChanged={onChanged} part={{ report, tick }} />
      ))}
    </div>
  );
}
