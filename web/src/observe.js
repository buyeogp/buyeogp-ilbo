/**
 * 화면 오류 수집 (Sentry) — 런북 7단계
 *
 * 빌드할 때 VITE_SENTRY_DSN 이 있을 때만 켠다. 없으면 Sentry 코드를 받지도 않는다
 * (동적 import 라 별도 파일로 떨어지고, 부르지 않으면 내려받지 않는다).
 *
 * 보내지 않는 것: 입력한 값 · 쿠키 · IP · 화면 녹화. 사용자 번호만 붙인다.
 * 화면의 숫자 칸은 두수와 이각번호라 input 값이 새지 않게 클릭 기록도 요소 이름까지만 남긴다.
 */
const DSN = import.meta.env.VITE_SENTRY_DSN;
let sentry = null;
let user = null;                 // 로그인이 init 보다 먼저 끝날 수 있다

export async function initObserve() {
  if (!DSN) return;
  try {
    sentry = await import('./sentry-lazy.js');
    sentry.init({
      dsn: DSN,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend(event) {
        if (event.request) {
          delete event.request.cookies;
          delete event.request.headers;
          if (event.request.url) event.request.url = event.request.url.split('?')[0];
        }
        return event;
      },
      beforeBreadcrumb(b) {
        // fetch 기록은 주소와 상태만 — 본문은 원래 안 싣지만 쿼리도 뗀다
        if (b.category === 'fetch' && b.data?.url) b.data.url = String(b.data.url).split('?')[0];
        return b;
      },
    });
    sentry.setUser(user);
  } catch {
    sentry = null;               // 오류 수집이 화면을 막아서는 안 된다
  }
}

export function setObserveUser(me) {
  user = me?.id ? { id: String(me.id) } : null;
  sentry?.setUser(user);
}

export function reportError(err, extra) {
  sentry?.captureException(err, extra ? { extra } : undefined);
}
