/**
 * 계정·담당 관리 — /api/admin  (설계문서 §6.1 / §6.3 / §6.7)
 *
 * 현장에 배포한 뒤에는 개발자가 붙지 않는다. 담당이 수시로 바뀌는 현장이라
 * **관리자 등급을 받은 사람이 직접** 고칠 수 있어야 한다.
 *
 * 그래서 열되, 두 가지는 지킨다.
 *   1. 역할(등급) 변경은 본사만 — 팀장이 스스로 확정 권한을 가질 수 없다 (SoD-1)
 *   2. 무엇을 바꾸든 감사로그에 남는다 (§6.6)
 *
 * 담당(어느 돈사를 맡나)은 자유롭다. 그게 매일 바뀌는 것이기 때문이다.
 */
import { Router } from 'express';
import { atx, adminConfigured } from '../../db/adminPool.js';
import { hashPassword, generatePassword } from '../../auth/password.js';
import { HttpError, requireAuth, wrap } from '../middleware.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toLocaleDateString('sv-SE');

/** 본사만 할 수 있는 일 — 역할 부여가 여기 들어간다 */
const HQ = ['hq_staff', 'hq_manager'];
const isHq = (u) => u.roles.some((r) => HQ.includes(r));

/** 현장 등급 — 관리자가 만들 수 있는 범위 */
const FIELD_ROLES = ['worker', 'team_lead', 'farm_manager'];
const ALL_ROLES = [...FIELD_ROLES, 'hq_staff', 'hq_manager', 'auditor', 'admin'];

adminRouter.use((req, _res, next) => {
  if (!adminConfigured()) {
    return next(new HttpError(503, 'admin_not_configured',
      '계정 관리 연결이 아직 설정되지 않았습니다. 서버에서 설정이 필요합니다.'));
  }
  // 「관리자」는 직책이 아니라 부여되는 권한이다. 팀장이 함께 가질 수 있다.
  if (!req.user.roles.includes('admin') && !isHq(req.user)) {
    return next(new HttpError(403, 'forbidden',
      '계정 관리 권한이 없습니다. 본사에 관리자 권한을 요청하십시오.'));
  }
  next();
});

const requireHq = (req, _res, next) => {
  if (!isHq(req.user)) {
    return next(new HttpError(403, 'hq_only',
      '등급 변경은 본사만 할 수 있습니다. 담당 돈사는 여기서 바로 바꿀 수 있습니다.'));
  }
  next();
};

// ── 화면 한 장을 채우는 조회 ──────────────────────────────────────────
/** 계정 · 돈사별 담당 · 내가 무엇을 할 수 있나 — 한 번에 준다 */
adminRouter.get('/overview', wrap(async (req, res) => {
  const out = await atx(req.user.userId, async (q) => {
    const users = await q.all(`
      SELECT u.id, u.login_id, u.name, u.status::text, u.nationality,
             u.last_login_at, u.mfa_required,
             COALESCE(array_agg(DISTINCT r.role::text)
                      FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
        FROM sec.app_user u
        LEFT JOIN sec.user_role r
               ON r.user_id = u.id
              AND r.valid_from <= current_date
              AND (r.valid_to IS NULL OR r.valid_to >= current_date)
       WHERE u.login_id NOT LIKE 'system.%'
       GROUP BY u.id
       ORDER BY u.name`);

    const scopes = await q.all(`
      SELECT s.id, s.user_id, s.house_id, s.farm_id,
             s.valid_from::text AS valid_from,
             s.valid_to::text   AS valid_to,
             (s.valid_from <= current_date
              AND (s.valid_to IS NULL OR s.valid_to >= current_date)) AS active
        FROM sec.user_scope s
       ORDER BY s.valid_from DESC`);

    const houses = await q.all(
      `SELECT id, farm_id, code, name, type::text, seq FROM app.house
        WHERE active ORDER BY seq`);

    const owners = await q.all(
      `SELECT house_id, code, name, lead_count, manager_count, holders
         FROM sec.v_house_owner ORDER BY seq`);

    return { users, scopes, houses, owners };
  });

  res.json({
    ...out,
    users: out.users.map((u) => ({
      id: u.id, loginId: u.login_id, name: u.name, status: u.status,
      nationality: u.nationality, roles: u.roles,
      lastLoginAt: u.last_login_at, mfaRequired: u.mfa_required,
    })),
    scopes: out.scopes.map((s) => ({
      id: s.id, userId: s.user_id, houseId: s.house_id, farmId: s.farm_id,
      validFrom: s.valid_from, validTo: s.valid_to, active: s.active,
    })),
    owners: out.owners.map((o) => ({
      houseId: o.house_id, code: o.code, name: o.name,
      leadCount: o.lead_count, managerCount: o.manager_count, holders: o.holders,
    })),
    // 화면은 이걸 보고 단추를 감춘다. 막는 것은 서버다 (§6.7)
    can: { roles: isHq(req.user), scopes: true, users: true },
    me: { userId: req.user.userId, roles: req.user.roles },
  });
}));

/** 변경 이력 — 누가 언제 무엇을 바꿨나 (§6.6) */
adminRouter.get('/audit', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 300);
  const rows = await atx(req.user.userId, (q) => q.all(`
    SELECT a.id, a.occurred_at, a.action::text, a.table_name, a.detail,
           u.name AS actor_name, u.login_id AS actor_login
      FROM sec.audit_log a
      LEFT JOIN sec.app_user u ON u.id = a.user_id
     WHERE a.table_name LIKE 'sec.%'
     ORDER BY a.id DESC LIMIT $1`, [limit]));
  res.json({
    entries: rows.map((r) => ({
      id: r.id, at: r.occurred_at, action: r.action, table: r.table_name,
      detail: r.detail, actor: r.actor_name ?? r.actor_login ?? '(삭제된 계정)',
    })),
  });
}));

// ── 담당 (자유롭게) ───────────────────────────────────────────────────
/**
 * 담당 배정. 기간을 가진 표이므로 **덮어쓰지 않는다** — 새 줄을 연다.
 * `from` 이 미래여도 된다. 「10월 1일부터 넘긴다」를 미리 넣어 둘 수 있다.
 */
adminRouter.post('/scopes', wrap(async (req, res) => {
  const { userId, houseId } = req.body ?? {};
  const from = req.body?.from ?? today();
  if (!userId || !houseId) throw new HttpError(400, 'bad_request', '사람과 돈사를 골라 주십시오.');
  if (!DATE.test(from)) throw new HttpError(400, 'bad_request', '날짜 형식이 올바르지 않습니다.');

  const out = await atx(req.user.userId, async (q) => {
    const u = await q.one('SELECT id, name FROM sec.app_user WHERE id = $1', [userId]);
    if (!u) throw new HttpError(404, 'not_found', '계정을 찾을 수 없습니다.');
    const h = await q.one('SELECT id, farm_id, code, name FROM app.house WHERE id = $1', [houseId]);
    if (!h) throw new HttpError(404, 'not_found', '돈사를 찾을 수 없습니다.');

    const dup = await q.one(
      `SELECT valid_from::text AS f FROM sec.user_scope
        WHERE user_id = $1 AND house_id = $2 AND valid_to IS NULL`, [userId, houseId]);
    if (dup) {
      throw new HttpError(409, 'already',
        `${u.name} 님은 이미 ${h.name} 담당입니다 (${dup.f} 부터).`);
    }

    const row = await q.one(
      `INSERT INTO sec.user_scope (user_id, farm_id, house_id, valid_from)
       VALUES ($1,$2,$3,$4::date) RETURNING id`, [userId, h.farm_id, houseId, from]);
    await q.log('UPDATE', 'sec.user_scope', row.id,
      `${u.name} → ${h.name} 담당 지정 (${from} 부터)`);
    return { scopeId: row.id, message: `${u.name} 님이 ${from} 부터 ${h.name} 담당입니다.` };
  });

  res.status(201).json(out);
}));

/**
 * 담당 해제. 지우지 않고 닫는다 — 「그때 누가 담당이었나」가 남아야 한다.
 * valid_to 는 포함이므로 적용일 **전날**로 닫는다.
 */
adminRouter.post('/scopes/end', wrap(async (req, res) => {
  const { userId, houseId } = req.body ?? {};
  const from = req.body?.from ?? today();
  if (!userId || !houseId) throw new HttpError(400, 'bad_request', '사람과 돈사를 골라 주십시오.');
  if (!DATE.test(from)) throw new HttpError(400, 'bad_request', '날짜 형식이 올바르지 않습니다.');

  const out = await atx(req.user.userId, async (q) => {
    const u = await q.one('SELECT id, name FROM sec.app_user WHERE id = $1', [userId]);
    const h = await q.one('SELECT id, name FROM app.house WHERE id = $1', [houseId]);
    if (!u || !h) throw new HttpError(404, 'not_found', '계정 또는 돈사를 찾을 수 없습니다.');

    const open = await q.all(
      `SELECT id, valid_from::text AS f FROM sec.user_scope
        WHERE user_id = $1 AND house_id = $2 AND valid_to IS NULL`, [userId, houseId]);
    if (!open.length) {
      throw new HttpError(409, 'not_assigned', `${u.name} 님은 ${h.name} 담당이 아닙니다.`);
    }
    for (const row of open) {
      if (row.f >= from) {
        throw new HttpError(422, 'bad_date',
          `${u.name} 님의 ${h.name} 담당은 ${row.f} 에 시작했습니다. `
          + `그보다 앞선 날짜로는 끝낼 수 없습니다.`);
      }
      await q(`UPDATE sec.user_scope SET valid_to = ($2::date - 1) WHERE id = $1`,
        [row.id, from]);
      await q.log('UPDATE', 'sec.user_scope', row.id,
        `${u.name} ← ${h.name} 담당 해제 (${from} 부터)`);
    }

    // 아무도 안 남았으면 알려 준다. 그 돈사 일보를 쓸 사람이 없어진다.
    const left = await q.one(
      `SELECT lead_count FROM sec.v_house_owner WHERE house_id = $1`, [houseId]);
    return {
      message: `${u.name} 님이 ${from} 부터 ${h.name} 담당에서 빠집니다.`,
      warning: (left?.lead_count ?? 0) <= 1
        ? `${h.name} 에 팀장이 없어집니다. 다른 사람을 지정해 주십시오.` : null,
    };
  });

  res.json(out);
}));

// ── 계정 ──────────────────────────────────────────────────────────────
/**
 * 계정을 만든다. 비밀번호는 난수로 만들어 **응답에 한 번만** 실어 보낸다.
 * 저장하지도, 로그에 남기지도 않는다.
 */
adminRouter.post('/users', wrap(async (req, res) => {
  const loginId = String(req.body?.loginId ?? '').trim().toLowerCase();
  const name = String(req.body?.name ?? '').trim();
  const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];

  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(loginId)) {
    throw new HttpError(400, 'bad_login_id',
      '아이디는 영문 소문자·숫자로 3~30자입니다. (예: kim.cs)');
  }
  if (!name) throw new HttpError(400, 'bad_request', '이름을 적어 주십시오.');
  for (const r of roles) {
    if (!ALL_ROLES.includes(r)) throw new HttpError(400, 'bad_role', `모르는 등급입니다: ${r}`);
    if (!FIELD_ROLES.includes(r) && !isHq(req.user)) {
      throw new HttpError(403, 'hq_only',
        '본사 등급은 본사만 줄 수 있습니다. 현장 등급으로 만든 뒤 본사에 요청하십시오.');
    }
  }

  const password = generatePassword();
  const hash = await hashPassword(password);

  const out = await atx(req.user.userId, async (q) => {
    const dup = await q.one('SELECT id FROM sec.app_user WHERE login_id = $1', [loginId]);
    if (dup) throw new HttpError(409, 'duplicate', `이미 있는 아이디입니다: ${loginId}`);

    const u = await q.one(
      `INSERT INTO sec.app_user (login_id, name, password_hash, status, nationality, mfa_required)
       VALUES ($1,$2,$3,'active',$4,$5) RETURNING id`,
      [loginId, hash ? name : name, hash,
       req.body?.nationality ?? 'KR',
       roles.some((r) => HQ.includes(r))]);

    for (const r of roles) {
      await q(`INSERT INTO sec.user_role (user_id, role) VALUES ($1,$2)`, [u.id, r]);
    }
    await q.log('INSERT', 'sec.app_user', u.id,
      `계정 생성 ${loginId} (${name})${roles.length ? ' · 등급 ' + roles.join(',') : ' · 등급 없음'}`);
    return { userId: u.id };
  });

  res.status(201).json({
    ...out, loginId, name, password,
    note: roles.length
      ? null
      : '등급이 없으면 로그인해도 할 수 있는 일이 없습니다. 본사에 등급 지정을 요청하십시오.',
  });
}));

/** 이름·상태 변경. 상태는 계정을 지우는 대신 쓰는 것이다 (§4.12) */
adminRouter.patch('/users/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const name = req.body?.name != null ? String(req.body.name).trim() : null;
  const status = req.body?.status ?? null;
  if (status && !['active', 'suspended', 'left'].includes(status)) {
    throw new HttpError(400, 'bad_status', '모르는 상태입니다.');
  }
  if (!name && !status) throw new HttpError(400, 'bad_request', '바꿀 내용이 없습니다.');

  const out = await atx(req.user.userId, async (q) => {
    const before = await q.one(
      'SELECT id, login_id, name, status::text FROM sec.app_user WHERE id = $1', [id]);
    if (!before) throw new HttpError(404, 'not_found', '계정을 찾을 수 없습니다.');

    // 자기 계정을 자기가 막아 버리는 사고를 막는다
    if (status && status !== 'active' && id === req.user.userId) {
      throw new HttpError(422, 'self_lock', '자기 계정은 스스로 중지할 수 없습니다.');
    }

    await q(`UPDATE sec.app_user
                SET name = COALESCE($2, name),
                    status = COALESCE($3::user_status, status)
              WHERE id = $1`, [id, name, status]);

    const bits = [];
    if (name && name !== before.name) bits.push(`이름 ${before.name} → ${name}`);
    if (status && status !== before.status) bits.push(`상태 ${before.status} → ${status}`);
    if (bits.length) {
      await q.log('UPDATE', 'sec.app_user', id, `${before.login_id} · ${bits.join(' · ')}`);
    }
    // 중지하면 열려 있는 세션도 끊는다 — 상태만 바꾸고 놔두면 그대로 쓴다
    if (status && status !== 'active') {
      await q(`UPDATE sec.session
                  SET revoked_at = now(), revoke_reason = '계정 상태 변경'
                WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    }
    return { changed: bits };
  });

  res.json(out);
}));

/** 임시 비밀번호 재발급. 화면에 한 번 보여 주고 어디에도 남기지 않는다. */
adminRouter.post('/users/:id/password', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const password = generatePassword();
  const hash = await hashPassword(password);

  const out = await atx(req.user.userId, async (q) => {
    const u = await q.one('SELECT id, login_id, name FROM sec.app_user WHERE id = $1', [id]);
    if (!u) throw new HttpError(404, 'not_found', '계정을 찾을 수 없습니다.');
    await q('UPDATE sec.app_user SET password_hash = $2 WHERE id = $1', [id, hash]);
    // 쓰던 세션은 끊는다. 비밀번호를 바꾼 뜻이 그것이다.
    await q(`UPDATE sec.session SET revoked_at = now(), revoke_reason = '비밀번호 재발급'
              WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    await q.log('UPDATE', 'sec.app_user', id, `${u.login_id} 비밀번호 재발급`);
    return { loginId: u.login_id, name: u.name };
  });

  res.json({ ...out, password, note: '이 화면에서만 보입니다. 본인에게 전달하십시오.' });
}));

/** 등급 변경 — 본사만 (SoD-1) */
adminRouter.post('/users/:id/roles', requireHq, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const roles = Array.isArray(req.body?.roles) ? req.body.roles : null;
  if (!roles) throw new HttpError(400, 'bad_request', '등급 목록이 필요합니다.');
  for (const r of roles) {
    if (!ALL_ROLES.includes(r)) throw new HttpError(400, 'bad_role', `모르는 등급입니다: ${r}`);
  }

  const out = await atx(req.user.userId, async (q) => {
    const u = await q.one('SELECT id, login_id, name FROM sec.app_user WHERE id = $1', [id]);
    if (!u) throw new HttpError(404, 'not_found', '계정을 찾을 수 없습니다.');

    // 마지막 본사 계정을 내리면 아무도 확정을 못 한다
    if (id === req.user.userId && !roles.some((r) => HQ.includes(r))) {
      const others = await q.one(`
        SELECT count(*)::int AS n FROM sec.user_role r
          JOIN sec.app_user au ON au.id = r.user_id AND au.status = 'active'
         WHERE r.role IN ('hq_staff','hq_manager') AND r.user_id <> $1
           AND r.valid_from <= current_date
           AND (r.valid_to IS NULL OR r.valid_to >= current_date)`, [id]);
      if ((others?.n ?? 0) === 0) {
        throw new HttpError(422, 'last_hq',
          '마지막 본사 계정입니다. 내리면 아무도 일보를 확정할 수 없습니다.');
      }
    }

    const before = (await q.all(
      `SELECT role::text AS role FROM sec.user_role
        WHERE user_id = $1 AND (valid_to IS NULL OR valid_to >= current_date)`, [id]))
      .map((r) => r.role).sort();

    await q('DELETE FROM sec.user_role WHERE user_id = $1', [id]);
    for (const r of roles) {
      await q('INSERT INTO sec.user_role (user_id, role) VALUES ($1,$2)', [id, r]);
    }
    await q('UPDATE sec.app_user SET mfa_required = $2 WHERE id = $1',
      [id, roles.some((r) => HQ.includes(r))]);

    const after = [...roles].sort();
    if (before.join(',') !== after.join(',')) {
      await q.log('UPDATE', 'sec.user_role', id,
        `${u.login_id} 등급 ${before.join(',') || '없음'} → ${after.join(',') || '없음'}`);
    }
    return { before, after };
  });

  res.json(out);
}));
