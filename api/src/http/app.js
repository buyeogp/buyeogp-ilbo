/**
 * HTTP 서버 조립 — 설계문서 §7.1
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { attachUser, errorHandler, noStore, HttpError } from './middleware.js';
import { authRouter } from './routes/auth.js';
import { reportsRouter } from './routes/reports.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);          // Caddy 뒤에 선다
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // 살아 있는지. 인증 없이 열어 둔다 — Docker healthcheck 가 본다
  app.get('/healthz', async (_req, res) => {
    try {
      const r = await pool.query('SELECT 1 AS ok');
      res.json({ ok: r.rows[0].ok === 1, env: config.env });
    } catch (e) {
      res.status(503).json({ ok: false, message: 'DB 에 닿지 않습니다.' });
    }
  });

  app.use('/api', noStore, attachUser);
  app.use('/api/auth', authRouter);
  app.use('/api/reports', reportsRouter);

  app.use('/api', (_req, _res, next) =>
    next(new HttpError(404, 'not_found', '없는 주소입니다.')));

  app.use(errorHandler);
  return app;
}
