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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, formatDate, shiftDate, STATUS_LABEL } from '../api.js';
import {
  Grid, MOVES, calcClosing, calcVariance, num, rowComplete, rowFaults, rowTouched,
} from '../components/Grid.jsx';

const CONFIRMERS = ['hq_staff', 'hq_manager'];
const UNCONFIRMERS = ['farm_manager', 'hq_staff', 'hq_manager'];

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

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await api.report(houseId, date);
      setData(d);
      setRows(d.rows.map(toEdit));
      setViolations(d.violations);
      setDirty(false);
    } catch (e) {
      setData(null);
      setErr(e instanceof ApiError ? e.message : '일보를 불러오지 못했습니다.');
    }
  }, [houseId, date]);

  useEffect(() => { load(); }, [load]);

  const status = data?.report?.status ?? null;
  const editable = !!data?.canWrite && status === 'draft' && !narrow;

  const change = useCallback((ri, key, value) => {
    setRows((old) => old.map((r, i) => (i === ri ? { ...r, [key]: value } : r)));
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
    setDirty(true);
  }, []);

  const missing = useMemo(() => rows.filter((r) => !rowComplete(r)).length, [rows]);
  const faulty = useMemo(
    () => rows.filter((r) => Object.keys(rowFaults(r)).length > 0).length, [rows]);

  const save = useCallback(async () => {
    if (!data?.report?.id || busy) return;
    setBusy('save'); setErr(null);
    try {
      const payload = rows.filter(rowTouched).map((r) => ({
        penId: r.penId, categoryId: r.categoryId, batchId: r.batchId ?? null,
        inHead: num(r.inHead), outHead: num(r.outHead),
        internalOutHead: num(r.internalOutHead), soldHead: num(r.soldHead),
        reportedClosingHead: r.reportedClosingHead === '' ? null : num(r.reportedClosingHead),
        varianceReason: r.varianceReason.trim() || null,
        note: r.note.trim() || null,
      }));
      if (!payload.length) { setBusy(null); return; }
      const res = await api.saveRows(data.report.id, payload);
      setViolations(res.violations);
      setDirty(false);
      await load();                 // 전일두수·당일두수는 저장 뒤에야 확정된다
      onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '저장하지 못했습니다.');
    } finally { setBusy(null); }
  }, [data, rows, busy, load, onChanged]);

  // Ctrl+S — 현장 PC 에서 가장 많이 눌릴 키다
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
  const unconfirm = () => act('unconfirm', () => api.unconfirm(data.report.id));

  const goDate = (delta) => {
    if (dirty && !window.confirm('저장하지 않은 내용이 있습니다. 그래도 이동할까요?')) return;
    nav(`/report/${houseId}/${shiftDate(date, delta)}`);
  };

  if (err && !data) return <div className="center">{err}</div>;
  if (!data) return <div className="center">불러오는 중…</div>;

  const canConfirm = me.user.roles.some((r) => CONFIRMERS.includes(r));
  const canUnconfirm = me.user.roles.some((r) => UNCONFIRMERS.includes(r));

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
        <button className="btn" onClick={() => goDate(-1)}>‹ 전날</button>
        <button className="btn" onClick={() => goDate(1)}>다음날 ›</button>
      </div>

      {narrow && (
        <div className="mobile-note">
          휴대폰에서는 <b>보기만</b> 됩니다. 입력은 사무실 컴퓨터에서 해 주십시오.
        </div>
      )}

      <Notes violations={violations} editable={editable}
             missing={editable ? missing : 0}
             faulty={editable ? faulty : 0} />

      {narrow
        ? <Cards rows={rows} houseName={data.house.name} />
        : <Grid rows={rows} basis={data.house.countBasis} houseName={data.house.name}
                readOnly={!editable} onChange={change} onRowNoChange={noChange} />}

      {err && <div className="notes"><div className="note block">{err}</div></div>}

      <div className="actionbar">
        {!narrow && editable && (
          <span className="hint">
            <kbd>Tab</kbd> 다음 칸 · <kbd>Enter</kbd> 다음 행 ·
            {' '}<kbd>Ctrl</kbd>+<kbd>Enter</kbd> 이 행 변동없음 ·
            {' '}<kbd>Ctrl</kbd>+<kbd>S</kbd> 임시저장
          </span>
        )}
        <span className="spacer" />

        {!status && data.canWrite && !narrow && (
          <button className="btn primary" onClick={start} disabled={busy === 'open'}>
            {busy === 'open' ? '여는 중…' : '일보 시작'}
          </button>
        )}

        {editable && (
          <>
            <button className="btn" onClick={save} disabled={!dirty || busy === 'save'}>
              {busy === 'save' ? '저장 중…' : dirty ? '임시저장' : '저장됨'}
            </button>
            <button className="btn primary" onClick={submit}
                    disabled={busy != null || missing > 0 || faulty > 0}>
              {busy === 'submit' ? '제출 중…' : '제출'}
            </button>
          </>
        )}

        {status === 'submitted' && canConfirm && (
          <button className="btn primary" onClick={confirm} disabled={busy != null}>
            {busy === 'confirm' ? '확정 중…' : '확정'}
          </button>
        )}
        {(status === 'confirmed' || status === 'locked') && canUnconfirm && (
          <button className="btn" onClick={unconfirm} disabled={busy != null}>확정 해제</button>
        )}
      </div>
    </>
  );
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
function Cards({ rows, houseName }) {
  return (
    <div className="cards">
      {rows.map((r) => {
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
              <span>폐사 <b>{num(r.deadHead) + num(r.culledHead)}</b></span>
              {v != null && v !== 0 && <span style={{ color: 'var(--crit)' }}>차이 <b>{v}</b></span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
