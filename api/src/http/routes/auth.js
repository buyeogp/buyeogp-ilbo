/**
 * 인증 — /api/auth
 */
import { Router } from 'express';
import { login, logout, siblingSessions, cookieOptions } from '../../auth/session.js';
import { config } from '../../config.js';
import { HttpError, requireAuth, wrap } from '../middleware.js';
import { hashPassword, passwordProblem, verifyPassword } from '../../auth/password.js';
import { adminConfigured, atx } from '../../db/adminPool.js';

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
    user: { id: u.userId, loginId: u.loginId, name: u.name, roles: u.roles,
            mustChangePassword: !!u.mustChangePassword },
    // 담당 돈사. house_id 가 null 인 스코프는 농장 전체를 뜻한다
    scopes: u.scopes.map((s) => ({
      farmId: s.farm_id, houseId: s.house_id,
      houseCode: s.house_code, houseName: s.house_name,
    })),
    session: { idleExp: u.idleExp, absoluteExp: u.absoluteExp },
  });
}));

/**
 * 내 비밀번호 바꾸기 (027).
 * 지금 비밀번호를 한 번 더 받는다 — 자리를 비운 사이 누가 켜 둔 화면으로 바꾸지 못하게.
 * 비밀번호 열은 앱 계정이 못 고친다(SoD-3). 계정 관리 연결로 바꾸고 감사로그를 남긴다.
 * 다른 곳에 열려 있던 내 로그인은 끊는다 — 지금 이 화면만 남는다.
 */
authRouter.post('/password', requireAuth, wrap(async (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');
  if (!adminConfigured()) {
    throw new HttpError(503, 'admin_not_configured', '지금은 비밀번호를 바꿀 수 없습니다. 관리자에게 알려 주십시오.');
  }
  const problem = passwordProblem(next, req.user.loginId);
  if (problem) throw new HttpError(422, 'weak_password', problem);
  if (current === next) throw new HttpError(422, 'same_password', '지금 비밀번호와 다르게 정해 주십시오.');

  await atx(req.user.userId, async (q) => {
    const u = await q.one('SELECT password_hash FROM sec.app_user WHERE id = $1', [req.user.userId]);
    if (!u || !(await verifyPassword(current, u.password_hash))) {
      throw new HttpError(422, 'wrong_current', '지금 비밀번호가 맞지 않습니다.');
    }
    await q(`UPDATE sec.app_user
                SET password_hash = $2, must_change_password = false, password_changed_at = now()
              WHERE id = $1`, [req.user.userId, await hashPassword(next)]);
    await q(`UPDATE sec.session SET revoked_at = now(), revoke_reason = '비밀번호 변경 (본인)'
              WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [req.user.userId, req.user.sessionId]);
    await q.log('UPDATE', 'sec.app_user', req.user.userId, `${req.user.loginId} 비밀번호 변경 (본인)`);
  });
  res.json({ ok: true });
}));
