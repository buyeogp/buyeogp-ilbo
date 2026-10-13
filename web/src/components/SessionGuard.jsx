/**
 * 자동 로그아웃 안내 — 「2분 뒤 자동 로그아웃됩니다 [계속 사용]」 · 끝나면 바로 로그인 화면
 *
 * 만료 시각은 서버가 매 응답에 실어 보낸다(X-Session-Exp). 화면은 그 시각을 기다리기만 한다.
 * 안내를 띄우기 직전과 0초에는 서버에 한 번 더 묻는다(/auth/session — 묻는 것은 연장하지
 * 않는다). 같은 계정을 다른 탭·기기에서 쓰고 있으면 서버 쪽 시각이 이미 늦춰져 있으니
 * 그때는 안내 없이 그 시각을 따른다.
 */
import { useEffect, useRef, useState } from 'react';
import { api, session } from '../api.js';

const WARN_MS = 2 * 60 * 1000;

export function SessionGuard({ onExpired }) {
  const [left, setLeft] = useState(null);          // 안내 중이면 남은 초
  const checking = useRef(false);

  useEffect(() => {
    const off = session.on((type) => {
      if (type === 'expired') onExpired();
      if (type === 'exp') setLeft(null);            // 무언가 했다 — 연장됐다
    });

    const tick = async () => {
      if (!session.exp || checking.current) return;
      const ms = session.exp.getTime() - Date.now();
      if (ms > WARN_MS) { setLeft(null); return; }
      // 안내 직전 · 만료 순간 — 다른 곳에서 연장됐는지 서버에 확인
      if (left == null || ms <= 0) {
        checking.current = true;
        try {
          await api.sessionExp();                    // 헤더로 session.exp 가 새로 들어온다
        } catch { /* 401 이면 위 'expired' 가 처리한다 */ }
        checking.current = false;
        const again = session.exp ? session.exp.getTime() - Date.now() : 0;
        if (again <= 0) { onExpired(); return; }
        if (again > WARN_MS) { setLeft(null); return; }
        setLeft(Math.ceil(again / 1000));
        return;
      }
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    const t = setInterval(tick, 1000);
    return () => { clearInterval(t); off(); };
  }, [onExpired, left]);

  if (left == null) return null;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div className="session-warn" role="alertdialog" aria-live="assertive">
      <span><b>{mm}:{ss}</b> 뒤 자동 로그아웃됩니다. 한동안 아무 동작이 없었습니다.</span>
      <button type="button" className="btn small primary" autoFocus
              onClick={() => api.me().catch(() => {})}>계속 사용</button>
    </div>
  );
}
