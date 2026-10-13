/**
 * 권한 미들웨어 — 설계문서 §6.2 / §6.7
 *
 * 「권한 검사는 서버 API 전건 검사. 프런트 메뉴 숨김은 UX 일 뿐」(§6.7)
 * 여기가 그 전건 검사다. RLS 는 그 아래 최후 방어선이다.
 *
 * 두 겹을 다 두는 이유는 실패 방식이 다르기 때문이다.
 *   · 미들웨어는 403 으로 거절한다 — 왜 막혔는지 말해 준다
 *   · RLS 는 조용히 0행을 준다 — 새어 나가지 않는다
 */
import { resolve } from '../auth/session.js';
import { config } from '../config.js';
import { describeDbError } from '../db/pool.js';
import { report } from '../observe.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 쿠키를 보고 req.user 를 채운다. 없으면 그냥 비워 둔다 (거절은 requireAuth 가) */
// 이 주소는 세션을 연장하지 않는다 — 「언제 로그아웃되나」를 묻기만 하는 곳
// 실시간 알림 연결도 활동이 아니다 — 다시 붙을 때마다 연장되면 무조작 로그아웃이 밀린다
const NO_TOUCH = ['/api/auth/session', '/api/events'];

export async function attachUser(req, res, next) {
  try {
    const touch = !NO_TOUCH.includes((req.originalUrl || '').split('?')[0]);
    req.user = await resolve(req.cookies?.[config.session.cookie], { touch });
    // 화면이 「2분 전 안내」를 띄우려고 매 응답에서 만료 시각을 읽는다 (같은 주소라 그대로 읽힌다)
    if (req.user) res.set('X-Session-Exp', sessionExp(req.user).toISOString());
    next();
  } catch (e) { next(e); }
}

/** 무조작 만료와 절대 만료 중 이른 쪽 */
export const sessionExp = (u) => new Date(Math.min(
  new Date(u.idleExp).getTime(), new Date(u.absoluteExp).getTime()));

// 비밀번호를 바꾸기 전에도 쓸 수 있는 곳 — 나는 누구인가 · 바꾸기 · 나가기
const BEFORE_CHANGE = ['/api/auth/me', '/api/auth/password', '/api/auth/logout', '/api/auth/session'];

export function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(new HttpError(401, 'unauthenticated', '로그인이 필요합니다.'));
  }
  // 발급받은 비밀번호 그대로면 새 비밀번호부터 정하게 한다 (027). 화면도 막지만 서버가 막는다
  if (req.user.mustChangePassword
      && !BEFORE_CHANGE.includes((req.originalUrl || '').split('?')[0])) {
    return next(new HttpError(403, 'must_change_password',
      '처음 받은 비밀번호입니다. 새 비밀번호를 정한 뒤에 쓸 수 있습니다.'));
  }
  next();
}

/** 역할 중 하나라도 있으면 통과 */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'unauthenticated', '로그인이 필요합니다.'));
  if (!req.user.roles.some((r) => roles.includes(r))) {
    return next(new HttpError(403, 'forbidden',
      `이 작업에는 ${roles.join(' 또는 ')} 권한이 필요합니다.`));
  }
  next();
};

const FARM_WIDE = ['farm_manager', 'hq_staff', 'hq_manager', 'auditor'];

/** 담당 돈사인지. 전 돈사 등급은 통과 */
export function canAccessHouse(user, houseId) {
  if (!user) return false;
  if (user.roles.some((r) => FARM_WIDE.includes(r))) return true;
  return user.scopes.some((s) => s.house_id == null || String(s.house_id) === String(houseId));
}

/** 쓰기는 담당 팀장·현장관리자만 (§6.2) */
// 일보를 쓰는 등급 — 본사도 현장 기능을 모두 한다 (발주처 요구 2026-10-13, DB 028 과 같은 목록)
const WRITERS = ['team_lead', 'farm_manager', 'hq_staff', 'hq_manager'];

export function canWriteHouse(user, houseId) {
  if (!user) return false;
  if (!user.roles.some((r) => WRITERS.includes(r))) return false;
  return canAccessHouse(user, houseId);
}

export const requireHouseWrite = (getHouseId) => (req, _res, next) => {
  const houseId = getHouseId(req);
  if (!canWriteHouse(req.user, houseId)) {
    return next(new HttpError(403, 'forbidden', '담당 돈사가 아닙니다.'));
  }
  next();
};

/** async 라우트의 예외를 next 로 넘긴다. Express 5 는 해 주지만 명시해 둔다. */
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** 마지막 방어선. DB 가 준 한국어 규칙 메시지를 그대로 내보낸다 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  const db = describeDbError(err);
  if (db) {
    if (db.status >= 500) { console.error('[db]', err); report(err, req); }
    return res.status(db.status).json({ error: db.code, message: db.message });
  }
  console.error('[500]', req.method, req.path, err);
  report(err, req);
  res.status(500).json({
    error: 'internal',
    message: '처리 중 문제가 생겼습니다. 같은 일이 반복되면 알려 주십시오.',
  });
}

/** 현장 PC 는 브라우저 캐시 때문에 옛 일보를 보는 일이 없어야 한다 */
export function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}
