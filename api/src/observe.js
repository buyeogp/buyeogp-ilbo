/**
 * 오류 수집 (Sentry) — 런북 7단계
 *
 * 현장 팀장이 오류를 말로 설명하기 어렵다. 500 이 나면 스택이 자동으로 올라오게 한다.
 * SENTRY_DSN 이 비어 있으면 아무것도 하지 않는다 — 개발 PC 와 시험은 그대로다.
 *
 * Sentry 는 해외(미국/EU) 서비스다. 무엇이 나가는지 여기서 정한다:
 *   보낸다   오류 종류 · 스택 · 요청 방식과 경로 · 사용자 번호(숫자) · 브라우저 종류
 *   안 보낸다 요청 본문(두수·이각번호·이름) · 쿠키(세션) · 헤더 · 쿼리 · IP · 사용자 이름
 * 4xx(권한 없음·검증 실패)는 정상 동작이라 보내지 않는다.
 */
import * as Sentry from '@sentry/node';
import { config } from './config.js';

let on = false;

export function initObserve() {
  if (!config.sentry.dsn) return;
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    sendDefaultPii: false,
    tracesSampleRate: 0,            // 성능 추적은 쓰지 않는다 — 오류만
    beforeSend: scrub,
  });
  on = true;
}

/** errorHandler 가 500 일 때만 부른다 */
export function report(err, req) {
  if (!on) return;
  Sentry.withScope((scope) => {
    scope.setTag('method', req.method);
    scope.setTag('route', routeOf(req));
    if (req.user?.userId) scope.setUser({ id: String(req.user.userId) });
    Sentry.captureException(err);
  });
}

export async function flushObserve() {
  if (on) await Sentry.close(2000);
}

// /api/reports/5/2026-09-28 → /api/reports/:n/:date — 같은 오류가 한 묶음으로 모이게
function routeOf(req) {
  return (req.originalUrl || req.path).split('?')[0]
    .replace(/\/\d{4}-\d{2}-\d{2}(?=\/|$)/g, '/:date')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
}

function scrub(event) {
  const r = event.request;
  if (r) {
    delete r.data;
    delete r.cookies;
    delete r.query_string;
    const ua = r.headers?.['user-agent'];
    r.headers = ua ? { 'user-agent': ua } : {};
    if (r.url) r.url = r.url.split('?')[0];
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  return event;
}
