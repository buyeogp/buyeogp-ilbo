/**
 * 기동 — node src/server.js
 */
import { createApp } from './http/app.js';
import { config } from './config.js';
import { close } from './db/pool.js';
import { closeAdmin } from './db/adminPool.js';
import { initObserve, flushObserve } from './observe.js';

initObserve();

const server = createApp().listen(config.port, () => {
  console.log(`부여GP API · ${config.env} · http://localhost:${config.port}`);
  console.log(`  DB ${config.db.user}@${config.db.host}`);
  console.log(`  오류 수집 ${config.sentry.dsn ? 'Sentry · ' + config.sentry.environment : '꺼짐'}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} — 정리 중`);
    server.close(async () => { await close(); await closeAdmin(); await flushObserve(); process.exit(0); });
    setTimeout(() => process.exit(1), 8000).unref();
  });
}
