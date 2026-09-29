/**
 * 비밀번호 바꾸기 (027)
 *
 * 두 가지로 쓴다.
 *   forced — 관리 화면이 만들거나 재발급한 비밀번호로 처음 들어왔다. 새 비밀번호를
 *            정하기 전에는 다른 화면으로 못 간다 (서버도 막는다). 발급한 사람도 모르게.
 *   (기본) — 위쪽 내 이름을 눌러 언제든 바꾼다.
 *
 * 규칙은 서버가 판정한다. 여기 표시는 치는 동안 보여 주는 안내일 뿐이다.
 */
import { useState } from 'react';
import { api, ApiError } from '../api.js';

const rules = (next, again, loginId) => {
  const id = String(loginId ?? '').toLowerCase();
  const low = next.toLowerCase();
  return [
    { ok: next.length >= 8, text: '8자 이상' },
    { ok: next.length > 0 && !/^\d+$/.test(next), text: '숫자만은 안 됨 — 영문자를 섞기' },
    { ok: next.length > 0 && !(id && low.includes(id)), text: '아이디가 들어가지 않기' },
    { ok: next.length > 0 && next === again, text: '두 번 똑같이 넣기' },
  ];
};

export function ChangePassword({ me, forced, onDone, onCancel, onSignOut }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  const list = rules(next, again, me.user.loginId);
  const ready = current && list.every((r) => r.ok);

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setErr(null);
    try {
      await api.changePassword(current, next);
      setDone(true);
      setTimeout(() => onDone?.(), forced ? 1200 : 1500);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : '바꾸지 못했습니다.');
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="pwform">
      <h1>{forced ? '새 비밀번호를 정해 주십시오' : '비밀번호 바꾸기'}</h1>
      <p className="sub">
        {forced
          ? <>받은 비밀번호는 <b>처음 한 번만</b> 씁니다. 나만 아는 비밀번호로 바꿔야 다음 화면으로 갑니다.</>
          : <>{me.user.name} ({me.user.loginId})</>}
      </p>

      {err && <div className="err">{err}</div>}
      {done && <div className="okmsg">바꿨습니다. 다른 곳에 열려 있던 내 로그인은 끊었습니다.</div>}

      <label className="field" htmlFor="pw-cur">
        <span>{forced ? '받은 비밀번호' : '지금 비밀번호'}</span>
        <input id="pw-cur" type={show ? 'text' : 'password'} value={current} autoFocus
               autoComplete="current-password" onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="field" htmlFor="pw-new">
        <span>새 비밀번호</span>
        <input id="pw-new" type={show ? 'text' : 'password'} value={next}
               autoComplete="new-password" onChange={(e) => setNext(e.target.value)} />
      </label>
      <label className="field" htmlFor="pw-again">
        <span>새 비밀번호 한 번 더</span>
        <input id="pw-again" type={show ? 'text' : 'password'} value={again}
               autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
      </label>
      <label className="pw-show">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> 글자 보이기
      </label>

      <ul className="pw-rules">
        {list.map((r) => <li key={r.text} className={r.ok ? 'ok' : ''}>{r.ok ? '✓' : '·'} {r.text}</li>)}
      </ul>

      <button className="btn primary" type="submit" disabled={!ready || busy || done}>
        {busy ? '바꾸는 중…' : '바꿉니다'}
      </button>
      {forced
        ? <button type="button" className="btn linkish" onClick={onSignOut}>로그아웃</button>
        : <button type="button" className="btn linkish" onClick={onCancel}>닫기</button>}
    </form>
  );

  if (forced) return <div className="login">{form}</div>;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="login in-overlay">{form}</div>
    </div>
  );
}
