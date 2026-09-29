/**
 * 로그인 — 설계문서 §6.4
 *
 * 계정 공유를 막는 것이 이 화면의 절반이다. 같은 계정이 다른 곳에서도 열려
 * 있으면 그 사실을 **로그인한 사람에게** 알려 준다. 막지는 않는다 —
 * 막으면 현장이 일을 못 한다. 보이게 두면 스스로 정리한다.
 */
import { useState } from 'react';
import { api, ApiError } from '../api.js';

export function Login({ onDone }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.login(loginId.trim(), password);
      // 같은 계정이 다른 곳에도 열려 있다 — 들어간 화면 위쪽에 한 번 알린다 (§6.4)
      try {
        if (r.otherSessions > 0) {
          sessionStorage.setItem('otherLogin', JSON.stringify({ n: r.otherSessions, latest: r.otherLatest }));
        }
      } catch { /* 저장소를 못 쓰면 알림만 빠진다 */ }
      onDone(r);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : '로그인하지 못했습니다.');
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>부여GP 일보</h1>
        <p className="sub">농업회사법인 (주) 부여지피</p>

        {err && <div className="err">{err}</div>}

        <label className="field" htmlFor="loginId">
          <span>아이디</span>
          <input id="loginId" name="loginId" value={loginId} autoComplete="username"
                 autoFocus onChange={(e) => setLoginId(e.target.value)} />
        </label>

        <label className="field" htmlFor="password">
          <span>비밀번호</span>
          <input id="password" name="password" type="password" value={password}
                 autoComplete="current-password"
                 onChange={(e) => setPassword(e.target.value)} />
        </label>

        <button className="btn primary" type="submit" disabled={busy || !loginId || !password}>
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
