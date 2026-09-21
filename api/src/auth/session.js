/**
 * 세션 — 설계문서 §6.4 / §6.7
 *
 * 쿠키에는 난수 원본을, DB 에는 sha256 해시를 둔다. DB 가 새어도 세션을
 * 도용할 수 없다.
 *
 * 무조작 만료는 역할에 따라 다르다 — 현장 15분 / 본사 30분.
 * 판정은 sec.v_active_session 한 곳에서만 한다. 애플리케이션이 다시 계산하면
 * 두 곳의 기준이 어긋난다.
 */
import { randomBytes, createHash } from 'node:crypto';
import { anon, tx } from '../db/pool.js';
import { config, idleLimitFor } from '../config.js';
import { verifyPassword } from './password.js';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest();

/** 로그인. 실패해도 이유를 자세히 알려주지 않는다 — 계정 존재 여부가 새면 안 된다. */
export async function login({ loginId, password, ip, userAgent }) {
  return anon(async (q) => {
    const locked = await q.one('SELECT sec.fn_login_locked($1) AS locked', [loginId]);
    if (locked?.locked) {
      await q('INSERT INTO sec.login_attempt (login_id, success, ip) VALUES ($1,false,$2)',
        [loginId, ip ?? null]);
      return { ok: false, reason: 'locked',
               message: '실패가 여러 번 있었습니다. 15분 뒤에 다시 시도해 주십시오.' };
    }

    const u = await q.one(
      `SELECT id, login_id, name, password_hash, status, mfa_required
         FROM sec.app_user WHERE login_id = $1`, [loginId]);

    const ok = u && u.status === 'active'
      && await verifyPassword(password, u.password_hash);

    await q(`INSERT INTO sec.login_attempt (login_id, user_id, success, ip)
             VALUES ($1,$2,$3,$4)`, [loginId, u?.id ?? null, !!ok, ip ?? null]);

    if (!ok) {
      return { ok: false, reason: 'bad_credentials',
               message: '아이디 또는 비밀번호가 맞지 않습니다.' };
    }

    const roles = (await q.all(
      `SELECT role::text AS role FROM sec.user_role
        WHERE user_id = $1 AND valid_from <= current_date
          AND (valid_to IS NULL OR valid_to >= current_date)`, [u.id])).map((r) => r.role);

    if (!roles.length) {
      return { ok: false, reason: 'no_role',
               message: '권한이 배정되지 않은 계정입니다. 관리자에게 문의하십시오.' };
    }

    const token = randomBytes(32).toString('base64url');
    const idle = idleLimitFor(roles);
    const s = await q.one(
      `INSERT INTO sec.session (user_id, token_hash, idle_limit_s, absolute_exp, ip, user_agent)
       VALUES ($1,$2,$3, now() + make_interval(hours => $4), $5, $6)
       RETURNING id, absolute_exp`,
      [u.id, sha256(token), idle, config.session.absoluteHours, ip ?? null, userAgent ?? null]);

    await q('UPDATE sec.app_user SET last_login_at = now() WHERE id = $1', [u.id]);
    await q(`INSERT INTO sec.audit_log (user_id, action, ip, detail)
             VALUES ($1,'LOGIN',$2,$3)`, [u.id, ip ?? null, `세션 ${s.id}`]);

    return {
      ok: true, token,
      session: { id: s.id, absoluteExp: s.absolute_exp, idleLimitSec: idle },
      user: { id: u.id, loginId: u.login_id, name: u.name, roles, mfaRequired: u.mfa_required },
    };
  });
}

/**
 * 쿠키 토큰으로 현재 사용자를 찾는다.
 * 살아 있으면 마지막 활동 시각을 민다 — 이게 무조작 잠금의 기준이다.
 */
export async function resolve(token) {
  if (!token) return null;
  return anon(async (q) => {
    const s = await q.one(
      `SELECT id, user_id, login_id, name, idle_exp, absolute_exp
         FROM sec.v_active_session WHERE token_hash = $1`, [sha256(token)]);
    if (!s) return null;

    await q('UPDATE sec.session SET last_seen_at = now() WHERE id = $1', [s.id]);

    const roles = (await q.all(
      `SELECT role::text AS role FROM sec.user_role
        WHERE user_id = $1 AND valid_from <= current_date
          AND (valid_to IS NULL OR valid_to >= current_date)`, [s.user_id])).map((r) => r.role);

    // 스코프는 sec 에 있어 신원 없이도 읽히지만, 돈사 이름은 app.house 라
    // RLS 가 막는다. 그래서 신원을 밝힌 트랜잭션에서 따로 채운다.
    const scopes = await q.all(
      `SELECT us.farm_id, us.house_id
         FROM sec.user_scope us
        WHERE us.user_id = $1 AND us.valid_from <= current_date
          AND (us.valid_to IS NULL OR us.valid_to >= current_date)`, [s.user_id]);

    return {
      sessionId: s.id,
      userId: s.user_id,
      loginId: s.login_id,
      name: s.name,
      roles,
      scopes,
      farmIds: [...new Set(scopes.map((x) => x.farm_id))],
      idleExp: s.idle_exp,
      absoluteExp: s.absolute_exp,
    };
  }).then(async (u) => {
    if (!u || !u.scopes.length) return u;
    const ids = u.scopes.map((x) => x.house_id).filter((x) => x != null);
    if (!ids.length) return u;
    const names = await tx(u.userId, (q) => q.all(
      `SELECT id, code, name, seq FROM app.house WHERE id = ANY($1) ORDER BY seq`, [ids]));
    const byId = new Map(names.map((h) => [String(h.id), h]));
    u.scopes = u.scopes.map((sc) => ({
      ...sc,
      house_code: byId.get(String(sc.house_id))?.code ?? null,
      house_name: byId.get(String(sc.house_id))?.name ?? null,
      seq: byId.get(String(sc.house_id))?.seq ?? null,
    })).sort((a, b) => (a.seq ?? -1) - (b.seq ?? -1));
    return u;
  });
}

export async function logout(token, reason = '사용자 요청') {
  if (!token) return;
  await anon(async (q) => {
    const s = await q.one(
      `UPDATE sec.session SET revoked_at = now(), revoke_reason = $2
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING id, user_id`, [sha256(token), reason]);
    if (s) {
      await q(`INSERT INTO sec.audit_log (user_id, action, detail)
               VALUES ($1,'LOGOUT',$2)`, [s.user_id, `세션 ${s.id} — ${reason}`]);
    }
  });
}

/** 한 사용자의 다른 세션들 — 계정 공유를 화면에서 보이게 한다 (§6.4) */
export async function siblingSessions(userId, exceptSessionId) {
  return tx(userId, (q) => q.all(
    `SELECT id, issued_at, last_seen_at, ip, user_agent
       FROM sec.v_active_session
      WHERE user_id = $1 AND id <> $2
      ORDER BY last_seen_at DESC`, [userId, exceptSessionId]));
}

export const cookieOptions = (maxAgeSec) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.session.secure,
  path: '/',
  maxAge: maxAgeSec * 1000,
});
