/**
 * 일보 입력 — 설계문서 §8.1
 *
 * 화면이 무엇을 하지 **않는지**가 더 중요하다.
 *   · 두수를 계산해서 저장하지 않는다 — 변동분만 보낸다
 *   · 제출 가능 여부를 스스로 판정하지 않는다 — 서버 검증 결과를 보여 줄 뿐이다
 *   · 전날 값을 통째로 복사하는 단추를 두지 않는다 (§8.1)
 *
 * 화면이 하는 일은 하나다: **지금 무엇이 비어 있고 무엇이 어긋났는지**를
 * 위치와 색으로 보여 주는 것.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, formatDate, STATUS_LABEL } from '../api.js';
import {
  Grid, MOVES, calcClosing, calcVariance, num, rowComplete, rowFaults, rowTouched,
} from '../components/Grid.jsx';
import { DeathPanel } from '../components/DeathPanel.jsx';
import { DeathLog } from '../components/DeathLog.jsx';
import { DateNav } from '../components/DateNav.jsx';
import { on as onLive } from '../live.js';

const CONFIRMERS = ['hq_staff', 'hq_manager'];
const UNCONFIRMERS = ['farm_manager', 'hq_staff', 'hq_manager'];

/** 왜 못 고치는지. 막는 것보다 이유를 말하는 게 화면의 일이다 (§6.4 P10) */
const LOCKED = {
  submitted: '제출된 일보는 고칠 수 없습니다. 고쳐야 하면 정정전표를 발행하십시오.',
  confirmed: '확정된 일보는 고칠 수 없습니다. 고쳐야 하면 정정전표를 발행하십시오.',
  locked: '마감된 일보는 고칠 수 없습니다.',
};

const str = (v) => (v == null ? '' : String(v));

const toEdit = (r) => ({
  ...r,
  inHead: str(r.inHead),
  outHead: str(r.outHead),
  internalOutHead: str(r.internalOutHead),
  soldHead: str(r.soldHead),
  reportedClosingHead: str(r.reportedClosingHead),
  varianceReason: r.varianceReason ?? '',
  note: r.note ?? '',
});

/** 좁은 화면인가. 입력은 사무실 PC 에서 한다 — 여기서는 보여 주기만 한다 */
function useNarrow(px = 760) {
  const q = `(max-width:${px}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const fn = (e) => setNarrow(e.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [q]);
  return narrow;
}

export function DailyReport({ me, houseId, date, onChanged }) {
  const nav = useNavigate();
  const narrow = useNarrow();

  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(null);       // 'save' | 'submit' | ...
  const [err, setErr] = useState(null);
  const [violations, setViolations] = useState([]);
  const [saveState, setSaveState] = useState({ kind: 'idle' });  // 자동저장 표시
  const [deaths, setDeaths] = useState(null);   // { items, reasons, photoStorage }
  const [deathRow, setDeathRow] = useState(null);  // 등록 창을 연 줄 번호
  const [logOpen, setLogOpen] = useState(false);   // 이 돈사 오늘 폐사·도태 일지

  // 아직 서버에 안 보낸 줄. 화면을 다시 그려도 유지되어야 하므로 ref 에 둔다.
  const pending = useRef(new Set());
  const timer = useRef(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await api.report(houseId, date);
      setData(d);
      setRows(d.rows.map(toEdit));
      setViolations(d.violations);
      setDeaths(null);
      setDeathRow(null);
      // 폐사·도태 기록 — 사진 보완이 남은 줄을 표에 표시하려면 처음에 받아 둔다
      if (d.report) api.deaths(d.report.id).then(setDeaths).catch(() => {});
      setDirty(false);
      pending.current.clear();
      setSaveState({ kind: 'idle' });
    } catch (e) {
      setData(null);
      setErr(e instanceof ApiError ? e.message : '일보를 불러오지 못했습니다.');
    }
  }, [houseId, date]);

  useEffect(() => { load(); }, [load]);

  /**
   * 실시간 — 이 돈사·날짜가 바뀌었다는 알림이 오면 새로 받는다.
   * 입력 중인 화면은 **통째로 다시 받지 않는다** (치던 숫자가 날아간다).
   * 시스템이 정하는 값(전일·폐사·도태·당일)과 상태·안내만 고친다 — 자동 저장과 같은 방식.
   */
  const editableRef = useRef(false);
  const refreshLive = useCallback(async () => {
    try {
      const d = await api.report(houseId, date);
      if (!editableRef.current) { await load(); return; }
      const byKey = new Map(d.rows.map((r) => [`${r.penId ?? ''}|${r.categoryId ?? ''}`, r]));
      setRows((old) => old.map((r) => {
        const c = byKey.get(`${r.penId ?? ''}|${r.categoryId ?? ''}`);
        return c ? { ...r, openingHead: c.openingHead ?? r.openingHead,
                     deadHead: c.deadHead, culledHead: c.culledHead } : r;
      }));
      setData((old) => (old ? { ...old, report: d.report, canWrite: d.canWrite } : d));
      setViolations(d.violations);
      if (d.report) api.deaths(d.report.id).then(setDeaths).catch(() => {});
    } catch { /* 다음 알림 때 다시 */ }
  }, [houseId, date, load]);
  useEffect(() => onLive((type, ev) => {
    if (type === 'resync'
        || (type === 'change' && String(ev.houseId) === String(houseId) && ev.date === date
            && ev.kind !== 'printed')) {
      refreshLive();
    }
  }), [houseId, date, refreshLive]);

  const status = data?.report?.status ?? null;
  const editable = !!data?.canWrite && status === 'draft' && !narrow;
  editableRef.current = editable;

  const change = useCallback((ri, key, value) => {
    setRows((old) => old.map((r, i) => (i === ri ? { ...r, [key]: value } : r)));
    pending.current.add(ri);
    setDirty(true);
  }, []);

  /** 이 행은 변동이 없었다 — 빈칸을 0 으로 **명시**한다 (빈칸 금지) */
  const noChange = useCallback((ri) => {
    setRows((old) => old.map((r, i) => {
      if (i !== ri) return r;
      const next = { ...r };
      for (const k of MOVES) if (next[k] === '') next[k] = '0';
      return next;
    }));
    pending.current.add(ri);
    setDirty(true);
  }, []);

  /**
   * (A) 숫자를 하나라도 넣은 줄을 떠나면 그 줄의 나머지 빈칸을 0 으로.
   * 그 줄은 사람이 **본** 줄이다 — 「안 봤다」와 헷갈릴 일이 없다.
   * 손대지 않은 줄은 그대로 비워 둔다. 그게 빨간 세로선이 잡으려는 것이다.
   */
  const rowLeave = useCallback((ri) => {
    const r = rowsRef.current[ri];
    if (!r || rowComplete(r)) return;
    if (MOVES.some((k) => r[k] !== '' && r[k] != null)) noChange(ri);
  }, [noChange]);

  /**
   * (B) 「빈칸 0으로 채우기」 — 남은 빈칸을 한꺼번에. 줄 수를 서버에 남긴다(025).
   * 본사가 확정할 때 「N줄을 한꺼번에 채움」을 보고 정말 다 봤는지 물을 수 있게.
   */
  const [ask, setAsk] = useState(null);        // 'submit' | 'withdraw' | 'return' | 'unconfirm'
  const [backReason, setBackReason] = useState('');
  const [info, setInfo] = useState(null);

  const bulkPending = useRef(0);
  const [askBulk, setAskBulk] = useState(false);
  const fillAll = useCallback(() => {
    // 어느 줄인지는 지금 화면 값으로 먼저 센다 — setRows 의 갱신 함수는 나중에 돈다
    const idx = rowsRef.current.flatMap((r, i) => (rowComplete(r) ? [] : [i]));
    setRows((old) => old.map((r, i) => {
      if (!idx.includes(i)) return r;
      const next = { ...r };
      for (const k of MOVES) if (next[k] === '' || next[k] == null) next[k] = '0';
      return next;
    }));
    for (const i of idx) pending.current.add(i);
    bulkPending.current += idx.length;
    setAskBulk(false);
    setDirty(true);
  }, []);

  const missing = useMemo(() => rows.filter((r) => !rowComplete(r)).length, [rows]);
  const blankCells = useMemo(() => rows.reduce((a, r) =>
    a + MOVES.filter((k) => r[k] === '' || r[k] == null).length, 0), [rows]);
  const faulty = useMemo(
    () => rows.filter((r) => Object.keys(rowFaults(r)).length > 0).length, [rows]);

  /**
   * 보낼 수 있는 줄만 추려 보낸다.
   *
   * 규칙을 어긴 줄(재고 초과·사유 없는 차이)은 **일부러 뺀다.** 서버는 트랜잭션
   * 하나로 받으므로 한 줄이 걸리면 전부 거절된다 — 보고두수를 치는 순간 사유를
   * 적기도 전에 빨간 오류가 뜨고, 멀쩡한 43줄까지 저장이 안 된다.
   * 어긴 줄은 표에서 이미 붉게 보이고, 고치면 다음 차례에 저장된다.
   */
  const collect = useCallback(() => {
    const out = [];
    const sent = [];
    for (const ri of pending.current) {
      const r = rowsRef.current[ri];
      if (!r || !rowTouched(r)) continue;
      if (Object.keys(rowFaults(r)).length > 0) continue;
      sent.push(ri);
      out.push({
        penId: r.penId, categoryId: r.categoryId, batchId: r.batchId ?? null,
        inHead: num(r.inHead), outHead: num(r.outHead),
        internalOutHead: num(r.internalOutHead), soldHead: num(r.soldHead),
        reportedClosingHead: r.reportedClosingHead === '' ? null : num(r.reportedClosingHead),
        varianceReason: r.varianceReason.trim() || null,
        note: r.note.trim() || null,
      });
    }
    return { payload: out, sent };
  }, []);

  /**
   * 저장. 끝나고 표를 **다시 불러오지 않는다** — 되불러오면 그 사이 다른 칸에
   * 치고 있던 내용이 날아간다. 시스템이 정한 값(전일·당일·폐사)만 덮어쓴다.
   */
  const flush = useCallback(async () => {
    if (!data?.report?.id) return;
    const { payload, sent } = collect();
    if (!payload.length) {
      setSaveState((s) => (s.kind === 'saving' ? { kind: 'idle' } : s));
      return;
    }

    setSaveState({ kind: 'saving' });
    try {
      const bulk = bulkPending.current;
      const res = await api.saveRows(data.report.id, payload, undefined, bulk || undefined);
      bulkPending.current -= bulk;
      if (bulk) {
        setData((d) => (d?.report ? { ...d, report: { ...d.report,
          bulkZeroRows: (d.report.bulkZeroRows ?? 0) + bulk, bulkZeroAt: new Date().toISOString() } } : d));
      }
      for (const ri of sent) pending.current.delete(ri);

      const byKey = new Map(res.rows.map((r) => [`${r.penId ?? ''}|${r.categoryId ?? ''}`, r]));
      setRows((old) => old.map((r) => {
        const c = byKey.get(`${r.penId ?? ''}|${r.categoryId ?? ''}`);
        return c ? { ...r, filled: true, openingHead: c.openingHead,
                     deadHead: c.deadHead, culledHead: c.culledHead } : r;
      }));

      setViolations(res.violations);
      setDirty(pending.current.size > 0);
      setSaveState({ kind: 'saved', at: new Date(), held: pending.current.size });
      setErr(null);
      onChanged?.();
    } catch (e) {
      setSaveState({ kind: 'error' });
      setErr(e instanceof ApiError ? e.message : '저장하지 못했습니다.');
    }
  }, [data, collect, onChanged]);

  // 자동저장 — 타이핑이 멎고 1.2초. 칸마다 보내면 44행 일보가 수백 번 오간다.
  useEffect(() => {
    if (!editable || !dirty) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1200);
    return () => clearTimeout(timer.current);
  }, [rows, dirty, editable, flush]);

  // 화면을 떠나기 전에 한 번 더. 자동저장이 아직 안 돌았을 수 있다.
  useEffect(() => () => { clearTimeout(timer.current); }, []);

  // Ctrl+S 는 남겨 둔다 — 자동저장을 믿지 못할 때 손이 먼저 간다
  const save = useCallback(async () => {
    clearTimeout(timer.current);
    await flush();
  }, [flush]);

  useEffect(() => {
    const fn = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (editable) save();
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [editable, save]);

  async function act(kind, fn, done) {
    setBusy(kind); setErr(null);
    try { await fn(); await load(); onChanged?.(); if (done) done(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : '처리하지 못했습니다.'); }
    finally { setBusy(null); }
  }

  const start = () => act('open', () => api.open(houseId, date));
  const submit = () => act('submit', async () => {
    if (dirty) await save();
    await api.submit(data.report.id);
  });
  const confirm = () => act('confirm', () => api.confirm(data.report.id));
  // 확정 해제 뒤: 이미 뽑은 종이가 있으면 바꿔야 한다고 알린다
  const unconfirm = () => act('unconfirm', async () => {
    const r = await api.unconfirm(data.report.id);
    if (r.wasPrinted) setInfo('이미 출력한 일보입니다. 고쳐서 다시 확정하면 PDF 를 다시 뽑아 종이를 바꿔 주십시오.');
  });
  const withdraw = () => act('withdraw', () => api.withdraw(data.report.id));
  const sendBack = (reason) => act('return', () => api.sendBack(data.report.id, reason));

  // 넣던 것이 있으면 **묻지 않고 저장한 뒤** 옮긴다.
  // 「저장 안 했는데 갈까요?」는 답이 하나뿐인 질문이다 — 잃고 싶은 사람은 없다.
  // 다른 날로 가기 전에 치던 것을 저장한다
  const goTo = async (d) => {
    if (d === date) return;
    if (dirty) await save();
    nav(`/report/${houseId}/${d}`);
  };

  if (err && !data) return <div className="center">{err}</div>;
  if (!data) return <div className="center">불러오는 중…</div>;

  // 폐사·도태 창: 작성 중이면 등록·빼기, 제출 뒤 담당이면 사진 보완만, 그 밖은 보기만
  const deathMode = data.canWrite && status === 'draft' ? true
    : data.canWriteHouse ? 'photo' : 'none';
  const photoDue = new Set((deaths?.items ?? [])
    .filter((x) => x.kind === 'mortality' && !x.hasPhoto)
    .map((x) => `${x.penId ?? ''}|${x.categoryId ?? ''}`));
  const openDeaths = data.report ? (ri) => setDeathRow(ri) : undefined;

  const deathChanged = ({ add, remove, replace, row }) => {
    setDeaths((d) => {
      if (!d) return d;
      let items = d.items;
      if (add) items = [...items, add];
      if (remove) items = items.filter((x) => !(x.kind === remove.kind && x.id === remove.id));
      if (replace) items = items.map((x) => (x.kind === replace.kind && x.id === replace.id ? replace : x));
      return { ...d, items };
    });
    // 그 줄의 폐사·도태 칸은 서버가 센 값으로 바꾼다 — 화면이 더하지 않는다 (V7)
    if (row) {
      setRows((old) => old.map((r) => (
        String(r.penId ?? '') === String(row.penId ?? '')
        && String(r.categoryId ?? '') === String(row.categoryId ?? '')
          ? { ...r, deadHead: row.deadHead, culledHead: row.culledHead } : r)));
      // 제출을 막는 규칙(음수 재고 등)이 바뀌었을 수 있다 — 조용히 다시 받는다
      if (data.report) {
        api.report(houseId, date).then((d) => setViolations(d.violations)).catch(() => {});
      }
    }
  };

  const canConfirm = me.user.roles.some((r) => CONFIRMERS.includes(r));
  const official = status === 'confirmed' || status === 'locked';
  const canUnconfirm = me.user.roles.some((r) => UNCONFIRMERS.includes(r));

  // 입력이 막혀 있으면 반드시 이유를 적는다. 좁은 화면은 따로 알리고 있다.
  let locked = null;
  if (!narrow && !editable) {
    if (!status) {
      locked = data.canWrite
        ? '아직 시작하지 않은 일보입니다. 아래 「일보 시작」을 누르면 입력할 수 있습니다.'
        : '아직 시작하지 않은 일보입니다. 담당 팀장이 시작해야 합니다.';
    } else if (status !== 'draft') {
      locked = LOCKED[status];
    } else {
      locked = '담당 돈사가 아니어서 보기만 할 수 있습니다. 입력은 담당 팀장 계정에서 합니다.';
    }
  }

  return (
    <>
      <div className="house-banner">
        <h1>{data.house.name}</h1>
        <span className="date">{formatDate(date)}</span>
        <span className={'badge ' + (status ?? 'none')}>
          {STATUS_LABEL[status] ?? '미시작'}
        </span>
        {data.report?.authorName && (
          <span className="hint">작성 {data.report.authorName}
            {data.report.confirmerName ? ` · 확정 ${data.report.confirmerName}` : ''}</span>
        )}
        <span className="spacer" />
        <DateNav date={date} onGo={goTo} />
      </div>

      {narrow && (
        <div className="mobile-note">
          휴대폰에서는 숫자를 <b>보기만</b> 합니다. 입력은 사무실 컴퓨터에서 해 주십시오.
          {deathMode === true && <> <b>폐사·도태</b>는 휴대폰에서 사진과 함께 바로 등록할 수 있습니다.</>}
        </div>
      )}

      {locked && (
        <div className="notes">
          <div className="note info">
            <span className="where">{STATUS_LABEL[status] ?? '미시작'}</span>
            <span>{locked}</span>
          </div>
        </div>
      )}

      {deaths?.items?.length > 0 && (() => {
        const it = deaths.items;
        const n = (k) => it.filter((x) => x.kind === k).reduce((a, x) => a + x.headCount, 0);
        const due = it.filter((x) => x.kind === 'mortality' && !x.hasPhoto).length;
        return (
          <div className="death-bar">
            <span>오늘 폐사 <b>{n('mortality')}</b>두 · 도태 <b>{n('culling')}</b>두
              <span className="dim"> ({it.length}건)</span></span>
            {due > 0 && <span className="dl-due">사진 보완 필요 <b>{due}</b>건</span>}
            <button type="button" className="btn small" onClick={() => setLogOpen(true)}>일지 · 사진 보기</button>
          </div>
        );
      })()}

      {status === 'draft' && data.report?.returnReason && (
        <div className="notes">
          <div className="note block">
            <span className="where">되돌아옴</span>
            <span>
              <b>{data.report.returnedBy ?? '본사'}</b> 님이 되돌려 보냈습니다
              {data.report.returnedAt ? ` (${new Date(data.report.returnedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })})` : ''}:
              {' '}<b>{data.report.returnReason}</b> — 고친 뒤 다시 제출하십시오.
            </span>
          </div>
        </div>
      )}
      {info && (
        <div className="notes"><div className="note info"><span>{info}</span></div></div>
      )}

      {data.report?.bulkZeroRows > 0 && (
        <div className="notes">
          <div className={'note ' + (status === 'submitted' ? 'warn' : 'info')}>
            <span className="where">일괄 0</span>
            <span>
              빈칸 <b>{data.report.bulkZeroRows}줄</b>을 「빈칸 0으로 채우기」로 한꺼번에 채웠습니다
              {data.report.bulkZeroAt ? ` (${new Date(data.report.bulkZeroAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })})` : ''}.
              {status === 'submitted' ? ' 확정 전에 그 돈방들이 정말 변동 없었는지 확인해 주십시오.' : ''}
            </span>
          </div>
        </div>
      )}

      <Notes violations={violations} editable={editable}
             missing={editable ? missing : 0}
             faulty={editable ? faulty : 0} />

      {narrow
        ? <Cards rows={rows} houseName={data.house.name} onDeaths={openDeaths} photoDue={photoDue} />
        : <Grid rows={rows} basis={data.house.countBasis} houseName={data.house.name}
                readOnly={!editable} onChange={change} onRowNoChange={noChange}
                onRowLeave={editable ? rowLeave : undefined}
                onDeaths={openDeaths} photoDue={photoDue} />}

      {logOpen && (
        <DeathLog date={date} houseId={houseId} title={`${data.house.name} 폐사·도태`}
                  onClose={() => setLogOpen(false)} />
      )}

      {deathRow != null && deaths && rows[deathRow] && (
        <DeathPanel reportId={data.report.id} row={rows[deathRow]}
                    title={[rows[deathRow].penCode, rows[deathRow].categoryName]
                      .filter(Boolean).join(' · ') || data.house.name}
                    items={deaths.items} reasons={deaths.reasons}
                    photoStorage={deaths.photoStorage} canEdit={deathMode}
                    onClose={() => setDeathRow(null)} onChanged={deathChanged} />
      )}

      {err && <div className="notes"><div className="note block">{err}</div></div>}

      <div className="actionbar">
        {!narrow && editable && (
          <span className="hint">
            <kbd>Tab</kbd> 다음 칸 · <kbd>Enter</kbd> 다음 행 ·
            {' '}<kbd>Ctrl</kbd>+<kbd>Enter</kbd> 이 행 변동없음 ·
            {' '}<b>자동 저장됩니다</b>
          </span>
        )}
        <span className="spacer" />

        {/* 단추 순서는 상태가 바뀌어도 같다: PDF 는 늘 맨 왼쪽, 그 상태의 주된 동작
            (일보 시작 · 제출 · 제출 취소 · 확정 · 확정 해제)은 늘 맨 오른쪽 */}
        {/* 일보 PDF (§6.5). 확정 뒤는 공식 출력(출력 기록이 남는다), 그 전은 워터마크 미리보기.
            새 탭에서 연다 — 브라우저 PDF 화면에서 바로 인쇄한다 */}
        {data.report && data.rows.some((r) => r.filled) && (
          <button className="btn" onClick={() => window.open(`/api/reports/${data.report.id}/pdf`, '_blank')}
                  title={official ? '확정된 일보를 인쇄용 PDF 로 엽니다'
                                  : '확정 전이라 「미리보기」 표시가 찍힙니다. 공식 출력은 확정 뒤에 합니다'}>
            {official ? 'PDF 출력' : 'PDF 미리보기'}
          </button>
        )}

        {!status && data.canWrite && !narrow && (
          <button className="btn primary" onClick={start} disabled={busy === 'open'}>
            {busy === 'open' ? '여는 중…' : '일보 시작'}
          </button>
        )}

        {editable && missing > 0 && (askBulk ? (
          <span className="inline-confirm">
            빈칸 <b>{blankCells}칸 ({missing}줄)</b>을 0 으로 채웁니다. 한꺼번에 채웠다는 기록이 본사 확정 화면에 남습니다.
            <button className="btn small" onClick={() => setAskBulk(false)}>그대로 둡니다</button>
            <button className="btn small primary" onClick={fillAll}>채웁니다</button>
          </span>
        ) : (
          <button className="btn" onClick={() => setAskBulk(true)}
                  title="남은 빈칸을 모두 0 으로 채웁니다 — 변동이 정말 없었던 줄만 남았을 때 씁니다">
            빈칸 0으로 채우기 ({missing}줄)
          </button>
        ))}

        {editable && (
          <>
            <SaveState state={saveState} dirty={dirty} />
            {ask === 'submit' ? (
              <span className="inline-confirm">
                <b>제출하시겠습니까?</b>
                {' '}{rows.length}줄 · 폐사·도태 {rows.reduce((a, r) => a + num(r.deadHead) + num(r.culledHead), 0)}두
                {photoDue.size > 0 && <span className="dl-due"> · 폐사 사진 보완 {photoDue.size}줄 남음</span>}
                {' '}— 제출하면 고칠 수 없습니다(본사 확정 전에는 「제출 취소」로 되돌릴 수 있습니다).
                <button className="btn small" onClick={() => setAsk(null)}>다시 보기</button>
                <button className="btn small primary" disabled={busy != null}
                        onClick={() => { setAsk(null); submit(); }}>제출합니다</button>
              </span>
            ) : (
              <button className="btn primary" onClick={() => setAsk('submit')}
                      disabled={busy != null || missing > 0 || faulty > 0}>
                {busy === 'submit' ? '제출 중…' : '제출'}
              </button>
            )}
          </>
        )}

        {/* 제출 취소 — 확정 전이면 담당 팀장이 스스로 거둔다 */}
        {status === 'submitted' && data.canWriteHouse && (ask === 'withdraw' ? (
          <span className="inline-confirm">
            제출을 취소하고 다시 고칩니다. 본사 확정 대기에서 빠집니다.
            <button className="btn small" onClick={() => setAsk(null)}>그대로 둡니다</button>
            <button className="btn small primary" disabled={busy != null}
                    onClick={() => { setAsk(null); withdraw(); }}>제출 취소</button>
          </span>
        ) : (
          <button className="btn" onClick={() => setAsk('withdraw')} disabled={busy != null}>제출 취소</button>
        ))}

        {/* 되돌려 보내기 — 본사가 사유를 붙여 팀장에게. 사유는 팀장 화면 맨 위에 나온다 */}
        {status === 'submitted' && canUnconfirm && (ask === 'return' ? (
          <span className="inline-confirm">
            <label htmlFor="back-reason">고칠 곳</label>
            <input id="back-reason" className="back-reason" value={backReason} autoFocus
                   onChange={(e) => setBackReason(e.target.value)}
                   placeholder="예: 1-3 포유자돈 전출 다시 확인" />
            <button className="btn small" onClick={() => { setAsk(null); setBackReason(''); }}>그만두기</button>
            <button className="btn small primary" disabled={busy != null || !backReason.trim()}
                    onClick={() => { setAsk(null); sendBack(backReason.trim()); setBackReason(''); }}>
              되돌려 보내기
            </button>
          </span>
        ) : (
          <button className="btn" onClick={() => setAsk('return')} disabled={busy != null}>되돌려 보내기</button>
        ))}

        {status === 'submitted' && canConfirm && (
          <button className="btn primary" onClick={confirm} disabled={busy != null}>
            {busy === 'confirm' ? '확정 중…' : '확정'}
          </button>
        )}
        {(status === 'confirmed' || status === 'locked') && canUnconfirm && (ask === 'unconfirm' ? (
          <span className="inline-confirm">
            확정을 풀면 <b>제출됨</b>으로 돌아갑니다. 고칠 곳이 있으면 이어서 「되돌려 보내기」를 합니다.
            <button className="btn small" onClick={() => setAsk(null)}>그대로 둡니다</button>
            <button className="btn small primary" disabled={busy != null}
                    onClick={() => { setAsk(null); unconfirm(); }}>확정 해제</button>
          </span>
        ) : (
          <button className="btn" onClick={() => setAsk('unconfirm')} disabled={busy != null}>확정 해제</button>
        ))}
      </div>
    </>
  );
}

/**
 * 저장 상태. 조용히 저장하는 것이 가장 나쁘다 — 저장됐는지 모르면
 * 사람은 Ctrl+S 를 계속 누르거나, 안 눌렀다고 생각하고 다시 친다.
 */
function SaveState({ state, dirty }) {
  if (state.kind === 'saving') {
    return <span className="savestate"><i className="spin" />저장 중…</span>;
  }
  if (state.kind === 'error') {
    return <span className="savestate bad">저장 못 했습니다</span>;
  }
  if (state.kind === 'saved') {
    const t = state.at.toTimeString().slice(0, 5);
    return (
      <span className={state.held ? 'savestate warn' : 'savestate ok'}>
        {state.held
          ? `${t} 저장 · ${state.held}행은 고쳐야 저장됩니다`
          : `${t} 저장됨`}
      </span>
    );
  }
  return <span className="savestate">{dirty ? '곧 저장합니다' : '자동 저장'}</span>;
}

/**
 * 지금 막고 있는 것.
 *
 * 서버는 행마다 하나씩 준다 — 44행짜리 분만사는 빈 일보를 열자마자 55건이 온다.
 * 그걸 그대로 늘어놓으면 붉은 벽이 되어 정작 고쳐야 할 표가 화면 밖으로 밀린다.
 * **같은 규칙은 한 줄로 묶고 어디인지만 적는다.** 나머지는 표에서 색으로 보인다.
 */
const RULE_TEXT = {
  'L1-COMPLETE': '아직 입력되지 않은 행이 있습니다',
  'L1-COMPLETE-CAT': '아직 입력되지 않은 축종이 있습니다',
  'V7-DEAD': '폐사 두수가 폐사 등록과 맞지 않습니다',
  'V7-CULL': '도태 두수가 도태 등록과 맞지 않습니다',
  'V7-ORPHAN': '폐사 등록에 해당하는 일보 행이 없습니다',
  'V10-PHOTO': '폐사 사진이 없습니다',
  'V8-PENDING': '보낸 이동을 상대 돈사가 아직 받지 않았습니다',
  'V8-INBOX': '받아야 할 이동이 남아 있습니다',
};

function group(list) {
  const out = new Map();
  for (const v of list) {
    const g = out.get(v.ruleCode)
      ?? { code: v.ruleCode, severity: v.severity, n: 0, where: [], message: v.message };
    g.n += 1;
    if (v.penCode && g.where.length < 5 && !g.where.includes(v.penCode)) g.where.push(v.penCode);
    out.set(v.ruleCode, g);
  }
  return [...out.values()];
}

function Notes({ violations, editable, missing, faulty }) {
  const items = [];

  if (missing) {
    items.push({ kind: 'block', where: `${missing}행`,
      text: '아직 비어 있습니다. 변동이 없었으면 0 을 넣어 주십시오.' });
  }
  if (faulty) {
    items.push({ kind: 'block', where: `${faulty}행`,
      text: '붉은 칸을 고쳐 주십시오. 차이가 나면 사유가 있어야 합니다.' });
  }

  // 입력 중에는 미입력을 화면이 이미 세고 있다 — 서버 것까지 겹쳐 놓지 않는다
  const shown = editable && missing
    ? violations.filter((v) => !v.ruleCode.startsWith('L1-COMPLETE'))
    : violations;

  for (const g of group(shown)) {
    const kind = g.severity === 'block' ? 'block' : g.severity === 'warn' ? 'warn' : 'info';
    if (g.n === 1) {
      items.push({ kind, where: g.where[0] ?? '', text: g.message });
    } else {
      const rest = g.n - g.where.length;
      items.push({ kind, where: `${g.n}곳`,
        text: `${RULE_TEXT[g.code] ?? g.message}`
          + (g.where.length ? ` — ${g.where.join(', ')}${rest > 0 ? ` 외 ${rest}곳` : ''}` : '') });
    }
  }

  if (!items.length) return null;

  return (
    <div className="notes">
      {items.map((it, i) => (
        <div key={i} className={'note ' + it.kind}>
          <span className="where">{it.where}</span>
          <span>{it.text}</span>
        </div>
      ))}
    </div>
  );
}

/** 좁은 화면 — 돈방마다 지금 몇 마리인지. 돈사 안에서 확인용 */
function Cards({ rows, houseName, onDeaths, photoDue }) {
  return (
    <div className="cards">
      {rows.map((r, ri) => {
        const v = calcVariance(r);
        return (
          <div className="card" key={`${r.penId ?? 'x'}-${r.categoryId ?? 'x'}`}>
            <div className="top">
              <b>{[r.penCode, r.categoryName].filter(Boolean).join(' · ') || houseName}</b>
              <span className="now">{calcClosing(r)}<small> 두</small></span>
            </div>
            <div className="moves">
              <span>전일 <b>{num(r.openingHead ?? r.expectedOpeningHead)}</b></span>
              <span>전입 <b>{num(r.inHead)}</b></span>
              <span>전출 <b>{num(r.outHead) + num(r.internalOutHead)}</b></span>
              <span>판매 <b>{num(r.soldHead)}</b></span>
              <span>폐사·도태 <b>{num(r.deadHead) + num(r.culledHead)}</b></span>
              {v != null && v !== 0 && <span style={{ color: 'var(--crit)' }}>차이 <b>{v}</b></span>}
            </div>
            {onDeaths && (
              <button type="button" className="btn small card-deaths" onClick={() => onDeaths(ri)}>
                폐사·도태{photoDue?.has(`${r.penId ?? ''}|${r.categoryId ?? ''}`) ? ' · 사진 보완 필요' : ''}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
