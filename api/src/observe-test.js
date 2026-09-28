/**
 * Sentry 연결 확인 — 시험 오류 하나를 보낸다
 *   docker compose exec api node src/observe-test.js
 * Sentry → Issues 에 「[시험] 오류 수집 확인」이 1분 안에 보이면 된다.
 */
import { config } from './config.js';
import { initObserve, report, flushObserve } from './observe.js';

if (!config.sentry.dsn) {
  console.error('SENTRY_DSN 이 비어 있습니다. infra/.env 에 넣고 api 를 다시 띄우십시오.');
  process.exit(1);
}
initObserve();
report(new Error('[시험] 오류 수집 확인'), { method: 'TEST', originalUrl: '/observe-test' });
await flushObserve();
console.log(`보냈습니다 · ${config.sentry.environment} — Sentry 의 Issues 를 보십시오.`);
