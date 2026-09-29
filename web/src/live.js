/**
 * 실시간 알림 받기 — /api/events (설계문서 §5.8)
 *
 * 연결은 하나만 연다. 화면들은 on() 으로 듣는다.
 *   · 'change'  — 무엇이 바뀌었다 {kind, houseId, houseName, date, status, by, byId, note}
 *   · 'resync'  — 끊겼다 다시 붙었거나, 창으로 돌아왔다. 그 사이 놓친 알림이 있을 수 있으니
 *                 지금 보는 것을 한 번 새로 받는다
 *
 * 30초마다 새로 받는 식의 폴링은 두지 않는다 — 그 요청이 「활동」으로 기록돼
 * 15분 무조작 로그아웃(§6.7)이 영영 걸리지 않게 된다. 대신 다시 연결될 때와
 * 창으로 돌아올 때 새로 받는다.
 */
const listeners = new Set();
let es = null;
let stopped = true;
let wasDown = false;
let retry = 5000;
let timer = null;

const emit = (type, data) => { for (const fn of listeners) fn(type, data); };

function connect() {
  if (stopped) return;
  es = new EventSource('/api/events');
  es.addEventListener('hello', () => {
    retry = 5000;
    if (wasDown) emit('resync');
    wasDown = false;
  });
  es.addEventListener('change', (e) => {
    try { emit('change', JSON.parse(e.data)); } catch { /* 모양이 다르면 버린다 */ }
  });
  // 세션이 끝났다 — 다시 붙지 않는다. 다음 요청이 로그인 화면으로 보낸다
  es.addEventListener('bye', () => { stop(); emit('bye'); });
  es.onerror = () => {
    wasDown = true;
    // 서버가 401·502 를 주면 브라우저가 스스로 다시 붙지 않는다(CLOSED). 그때는 우리가 붙인다
    if (es.readyState === EventSource.CLOSED) {
      es = null;
      clearTimeout(timer);
      timer = setTimeout(connect, retry);
      retry = Math.min(retry * 2, 60_000);
    }
  };
}

let lastFocus = 0;
function onFocus() {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (now - lastFocus < 10_000) return;       // 창을 오가며 연달아 받지 않게
  lastFocus = now;
  emit('resync');
}

export function start() {
  if (!stopped) return;
  stopped = false;
  connect();
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('focus', onFocus);
}

export function stop() {
  stopped = true;
  clearTimeout(timer);
  es?.close();
  es = null;
  document.removeEventListener('visibilitychange', onFocus);
  window.removeEventListener('focus', onFocus);
}

/** @returns {() => void} 듣기를 그만두는 함수 */
export function on(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
