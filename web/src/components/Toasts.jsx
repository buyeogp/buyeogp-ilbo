/**
 * 화면 구석 알림 — 「자돈사 9/29 제출됨 · 라주」 (설계문서 §5.8)
 *
 * 다른 사람이 한 일만 띄운다(내가 누른 것은 내 화면이 이미 보여 준다).
 * 누르면 그 일보로 간다. 저절로 사라지고, 한꺼번에 네 개까지만 쌓는다.
 * 자동 저장·출력처럼 자주 일어나는 것은 띄우지 않는다 — 화면만 조용히 바뀐다.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { on } from '../live.js';

const SHOW = {
  submitted:   { text: '제출됨',        tone: 'ok' },
  withdrawn:   { text: '제출 취소',     tone: 'warn' },
  returned:    { text: '되돌아옴',      tone: 'crit', ms: 20_000 },
  confirmed:   { text: '확정됨',        tone: 'ok' },
  unconfirmed: { text: '확정 해제',     tone: 'warn' },
  started:     { text: '일보 시작',     tone: 'info', farmWideOnly: true },
  deaths:      { text: null,            tone: 'info', farmWideOnly: true },   // note 에 「폐사 2두」
};

const md = (d) => { const [, m, dd] = d.split('-'); return `${Number(m)}/${Number(dd)}`; };

export function Toasts({ me, farmWide }) {
  const nav = useNavigate();
  const [list, setList] = useState([]);

  useEffect(() => on((type, ev) => {
    if (type !== 'change') return;
    const s = SHOW[ev.kind];
    if (!s) return;
    if (String(ev.byId) === String(me.user.id)) return;       // 내가 한 일
    if (s.farmWideOnly && !farmWide) return;
    const id = `${ev.kind}-${ev.reportId}-${ev.at}`;
    const item = { id, ev, s };
    setList((l) => [item, ...l.filter((x) => x.id !== id)].slice(0, 4));
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), s.ms ?? 8000);
  }), [me.user.id, farmWide]);

  if (!list.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map(({ id, ev, s }) => (
        <div key={id} className={`toast ${s.tone}`}>
          <button type="button" className="toast-body"
                  onClick={() => { nav(`/report/${ev.houseId}/${ev.date}`); setList((l) => l.filter((x) => x.id !== id)); }}>
            <b>{ev.houseName} {md(ev.date)}</b> {s.text ?? ev.note}
            <span className="toast-by">
              {ev.by}{ev.kind === 'returned' && ev.note ? ` — ${ev.note}` : ''}
            </span>
          </button>
          <button type="button" className="toast-x" aria-label="닫기"
                  onClick={() => setList((l) => l.filter((x) => x.id !== id))}>×</button>
        </div>
      ))}
    </div>
  );
}
