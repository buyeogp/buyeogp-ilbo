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
import { deathsRouter, deathLogRouter } from './routes/deaths.js';
import { pdfRouter, dayPdfRouter } from './routes/pdf.js';
import { adminRouter } from './routes/admin.js';

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
  // 폐사·도태는 일보 아래에 있다. reportsRouter 의 /:houseId/:date 가 먼저 잡지 않게 앞에 둔다
  app.use('/api/reports/:reportId/deaths', deathsRouter);
  app.use('/api/reports/:reportId/pdf', pdfRouter);
  app.use('/api/pdf', dayPdfRouter);               // 하루치 묶음
  app.use('/api/deaths', deathLogRouter);          // 폐사·도태 일지 — 날짜 하나, 돈사 여럿
  app.use('/api/reports', reportsRouter);
  // 계정·담당 관리. 여기만 다른 DB 연결을 쓴다 — 업무 데이터가 안 보이는 연결이다
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, _res, next) =>
    next(new HttpError(404, 'not_found', '없는 주소입니다.')));

  app.use(errorHandler);
  return app;
}
