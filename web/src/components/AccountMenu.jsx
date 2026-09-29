/**
 * 내 이름 메뉴 — 비밀번호 바꾸기 · 열려 있는 로그인 (§6.4)
 *
 * 같은 계정으로 여러 곳에서 들어오는 것은 막지 않는다 (PC 로 일보, 휴대폰으로 폐사 사진).
 * 대신 **보이게** 한다 — 모르는 기기가 있으면 본인이 「다른 곳 모두 로그아웃」으로 끊는다.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';
import { ChangePassword } from '../pages/ChangePassword.jsx';

const when = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return today ? `오늘 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};

export function Sessions({ onClose }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => api.sessions().then((r) => setList(r.sessions))
    .catch((e) => setErr(e instanceof ApiError ? e.message : '불러오지 못했습니다.'));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const others = (list ?? []).filter((s) => !s.current).length;

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dpanel" role="dialog" aria-modal="true" aria-label="열려 있는 로그인">
        <div className="dp-head">
          <h2>열려 있는 로그인</h2>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>
        <p className="dim" style={{ marginTop: 0 }}>
          내 계정으로 지금 들어와 있는 곳입니다. <b>모르는 기기가 있으면</b> 누군가 내 비밀번호를 알고 있다는 뜻입니다 —
          아래에서 끊고 비밀번호를 바꾸십시오.
        </p>
        {err && <p className="dp-err">{err}</p>}
        {msg && <p className="dl-ok">{msg}</p>}
        {list && (
          <ul className="dp-list">
            {list.map((s) => (
              <li key={s.id}>
                <b>{s.device}</b>
                {s.current && <span className="dp-kind culling">이 기기</span>}
                <span className="dim">들어옴 {when(s.issuedAt)} · 마지막 사용 {when(s.lastSeenAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {others > 0 && (ask ? (
          <span className="inline-confirm">
            이 기기만 남기고 다른 {others}곳을 로그아웃합니다.
            <button className="btn small" onClick={() => setAsk(false)}>그대로 둡니다</button>
            <button className="btn small danger" onClick={async () => {
              setAsk(false);
              try {
                const r = await api.revokeOthers();
                setMsg(`${r.revoked}곳을 로그아웃했습니다.`);
                load();
              } catch (e) { setErr(e instanceof ApiError ? e.message : '끊지 못했습니다.'); }
            }}>로그아웃합니다</button>
          </span>
        ) : (
          <button className="btn" onClick={() => setAsk(true)}>다른 곳 모두 로그아웃 ({others})</button>
        ))}
      </div>
    </div>
  );
}

export function AccountMenu({ me, label }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(null);       // 'pw' | 'sessions'
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <span className="acct" ref={ref}>
      <button type="button" className="who" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} ▾
      </button>
      {open && (
        <span className="acct-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setView('pw'); }}>비밀번호 바꾸기</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setView('sessions'); }}>열려 있는 로그인</button>
        </span>
      )}
      {view === 'pw' && <ChangePassword me={me} onDone={() => setView(null)} onCancel={() => setView(null)} />}
      {view === 'sessions' && <Sessions onClose={() => setView(null)} />}
    </span>
  );
}
