/**
 * 인증 — /api/auth
 */
import { Router } from 'express';
import { login, logout, siblingSessions, cookieOptions } from '../../auth/session.js';
import { config } from '../../config.js';
import { HttpError, requireAuth, wrap } from '../middleware.js';

export const authRouter = Router();

const clientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0] ?? req.socket.remoteAddress ?? '').trim() || null;

authRouter.post('/login', wrap(async (req, res) => {
  const { loginId, password } = req.body ?? {};
  if (!loginId || !password) {
    throw new HttpError(400, 'bad_request', '아이디와 비밀번호를 입력하십시오.');
  }

  const r = await login({
    loginId: String(loginId).trim(),
    password: String(password),
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] ?? null,
  });

  if (!r.ok) {
    // 계정 존재 여부가 새지 않도록 상태 코드를 통일한다
    throw new HttpError(r.reason === 'locked' ? 429 : 401, r.reason, r.message);
  }

  res.cookie(config.session.cookie, r.token,
    cookieOptions(config.session.absoluteHours * 3600));

  // 같은 계정이 다른 곳에서도 열려 있으면 알려 준다 — 계정 공유 금지 (§6.4)
  const others = await siblingSessions(r.user.id, r.session.id);

  res.json({
    user: r.user,
    session: { idleLimitSec: r.session.idleLimitSec, absoluteExp: r.session.absoluteExp },
    otherSessions: others.length,
  });
}));

authRouter.post('/logout', wrap(async (req, res) => {
  await logout(req.cookies?.[config.session.cookie]);
  res.clearCookie(config.session.cookie, { path: '/' });
  res.json({ ok: true });
}));

/** 화면이 기동할 때 「나는 누구고 무엇을 할 수 있나」를 한 번에 받는다 */
authRouter.get('/me', requireAuth, wrap(async (req, res) => {
  const u = req.user;
  res.json({
    user: { id: u.userId, loginId: u.loginId, name: u.name, roles: u.roles },
    // 담당 돈사. house_id 가 null 인 스코프는 농장 전체를 뜻한다
    scopes: u.scopes.map((s) => ({
      farmId: s.farm_id, houseId: s.house_id,
      houseCode: s.house_code, houseName: s.house_name,
    })),
    session: { idleExp: u.idleExp, absoluteExp: u.absoluteExp },
  });
}));
