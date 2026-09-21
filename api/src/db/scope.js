/**
 * 담당 범위 변경 — 설계문서 §6.1 / §6.2
 *
 * 사람이 바뀌거나 돈사를 넘겨받으면 `sec.user_scope` 를 고쳐야 한다.
 * 그런데 그 표는 **기간을 가진 표**다. 손으로 UPDATE 하면 「그때 누가
 * 담당이었나」가 사라진다 — 지난 일보를 놓고 누구에게 물어야 할지 알 수 없게 된다.
 *
 * 그래서 이 도구는 절대 덮어쓰지 않는다. 옛 줄은 `valid_to` 로 닫고 새 줄을 연다.
 *
 *   node src/db/scope.js                                   현재 담당 현황
 *   node src/db/scope.js --user pemba                      한 사람
 *   node src/db/scope.js --house BIYUK_F                   한 돈사
 *   node src/db/scope.js --move BIYUK_F --to shin.dw       담당자 교체
 *   node src/db/scope.js --add  --user ham --house JADON   추가
 *   node src/db/scope.js --end  --user ham --house JADON   해제
 *   ... --from 2026-10-01                                  적용일 (기본 오늘)
 *   ... --dry                                              바꾸지 않고 보기만
 *
 * 계정 관리는 admin 영역이다(SoD-3). 앱 계정은 이 표에 쓰지 못하므로
 * 이 스크립트는 소유자 계정으로 붙는다.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../config.js';

// ── 인자 ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};

const DRY = flag('dry');
const FROM = opt('from') ?? new Date().toLocaleDateString('sv-SE');  // YYYY-MM-DD
if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM)) {
  console.error(`--from 날짜 형식이 올바르지 않습니다: ${FROM}`);
  process.exit(1);
}

// ── 접속 ──────────────────────────────────────────────────────────────
const envFile = {};
try {
  for (const l of readFileSync(path.join(ROOT, 'infra', '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) envFile[m[1]] = m[2].trim();
  }
} catch { /* 환경 변수를 쓴다 */ }

const client = new pg.Client({
  host: config.db.host, port: config.db.port,
  user: process.env.DB_MIGRATE_USER ?? envFile.DB_MIGRATE_USER,
  password: process.env.DB_MIGRATE_PASSWORD ?? envFile.DB_MIGRATE_PASSWORD,
  database: config.db.database, ssl: config.db.ssl,
  application_name: 'buyeogp-scope',
});
await client.connect();

const q = (sql, params) => client.query(sql, params).then((r) => r.rows);

async function findUser(loginId) {
  const [u] = await q('SELECT id, login_id, name FROM sec.app_user WHERE login_id = $1', [loginId]);
  if (!u) throw new Error(`계정을 찾을 수 없습니다: ${loginId}`);
  return u;
}

async function findHouse(code) {
  const [h] = await q('SELECT id, farm_id, code, name FROM app.house WHERE code = $1', [code]);
  if (!h) {
    const all = (await q('SELECT code FROM app.house WHERE active ORDER BY seq')).map((x) => x.code);
    throw new Error(`돈사 코드를 찾을 수 없습니다: ${code}\n  쓸 수 있는 코드: ${all.join(' ')}`);
  }
  return h;
}

const audit = (userId, detail) =>
  q(`INSERT INTO sec.audit_log (user_id, action, table_name, detail)
     VALUES ($1, 'UPDATE', 'sec.user_scope', $2)`, [userId, detail]);

// ── 현황 출력 ─────────────────────────────────────────────────────────
/** 돈사별로 지금 누가 보고 누가 쓰는지. 담당이 없는 돈사가 가장 위험하다. */
async function report() {
  const rows = await q(`
    SELECT h.code, h.name,
           COALESCE(string_agg(DISTINCT u.name, ', ' ORDER BY u.name)
                    FILTER (WHERE ro.role = 'team_lead'), '—') AS leads,
           COALESCE(string_agg(DISTINCT u.name, ', ' ORDER BY u.name)
                    FILTER (WHERE ro.role = 'farm_manager'), '—') AS managers
      FROM app.house h
      LEFT JOIN sec.user_scope us
             ON us.farm_id = h.farm_id
            AND (us.house_id IS NULL OR us.house_id = h.id)
            AND us.valid_from <= current_date
            AND (us.valid_to IS NULL OR us.valid_to >= current_date)
      LEFT JOIN sec.app_user u ON u.id = us.user_id AND u.status = 'active'
      LEFT JOIN sec.user_role ro
             ON ro.user_id = u.id
            AND ro.valid_from <= current_date
            AND (ro.valid_to IS NULL OR ro.valid_to >= current_date)
     WHERE h.active
     GROUP BY h.code, h.name, h.seq
     ORDER BY h.seq`);

  console.log('\n━━ 현재 담당 ━━');
  console.table(rows.map((r) => ({ 돈사: r.name, 코드: r.code, 팀장: r.leads, 현장관리: r.managers })));

  const orphan = rows.filter((r) => r.leads === '—');
  if (orphan.length) {
    console.log(`\n⚠ 팀장이 없는 돈사 ${orphan.length}곳 — ${orphan.map((r) => r.name).join(', ')}`);
    console.log('  아무도 일보를 쓸 수 없습니다. 현장관리 등급은 전 돈사를 쓸 수 있으나,');
    console.log('  매일 쓰는 사람이 정해져 있지 않으면 빠집니다.');
  }
}

/** 한 사람의 이력 — 닫힌 기간까지 보여 준다 */
async function history(loginId) {
  const u = await findUser(loginId);
  const rows = await q(`
    SELECT COALESCE(h.name, '전 돈사') AS house,
           us.valid_from::text AS f, COALESCE(us.valid_to::text, '—') AS t,
           (us.valid_from <= current_date
            AND (us.valid_to IS NULL OR us.valid_to >= current_date)) AS now
      FROM sec.user_scope us
      LEFT JOIN app.house h ON h.id = us.house_id
     WHERE us.user_id = $1
     ORDER BY us.valid_from DESC, house`, [u.id]);
  console.log(`\n━━ ${u.name} (${u.login_id}) 담당 이력 ━━`);
  console.table(rows.map((r) => ({ 돈사: r.house, 시작: r.f, 종료: r.t, 현재: r.now ? '●' : '' })));
}

async function houseHistory(code) {
  const h = await findHouse(code);
  const rows = await q(`
    SELECT u.name, u.login_id, us.valid_from::text AS f,
           COALESCE(us.valid_to::text, '—') AS t,
           (us.valid_from <= current_date
            AND (us.valid_to IS NULL OR us.valid_to >= current_date)) AS now
      FROM sec.user_scope us
      JOIN sec.app_user u ON u.id = us.user_id
     WHERE us.house_id = $1
     ORDER BY us.valid_from DESC`, [h.id]);
  console.log(`\n━━ ${h.name} (${h.code}) 담당 이력 ━━`);
  console.table(rows.map((r) => ({
    이름: r.name, 계정: r.login_id, 시작: r.f, 종료: r.t, 현재: r.now ? '●' : '',
  })));
}

// ── 변경 ──────────────────────────────────────────────────────────────
/** 옛 줄을 닫는다. 지우지 않는다 — valid_to 는 포함이므로 적용일 전날로 닫는다. */
async function endScope(user, house, from) {
  const open = await q(`
    SELECT id, valid_from::text AS vf FROM sec.user_scope
     WHERE user_id = $1 AND house_id = $2 AND valid_to IS NULL`, [user.id, house.id]);
  if (!open.length) {
    console.log(`  · ${user.name} 은(는) ${house.name} 담당이 아닙니다 — 넘어갑니다`);
    return false;
  }
  for (const row of open) {
    if (row.vf >= from) {
      throw new Error(
        `${user.name} 의 ${house.name} 담당은 ${row.vf} 에 시작했습니다.\n`
        + `  ${from} 로는 닫을 수 없습니다(시작보다 앞섭니다). --from 을 ${row.vf} 이후로 주십시오.`);
    }
    if (!DRY) {
      await q(`UPDATE sec.user_scope SET valid_to = ($2::date - 1) WHERE id = $1`, [row.id, from]);
      await audit(user.id, `${house.code} 담당 해제 (${from} 부터)`);
    }
    console.log(`  − ${user.name} ← ${house.name} 해제 (${row.vf} ~ ${from} 전날)`);
  }
  return true;
}

async function addScope(user, house, from) {
  const [dup] = await q(`
    SELECT valid_from::text AS vf FROM sec.user_scope
     WHERE user_id = $1 AND house_id = $2 AND valid_to IS NULL`, [user.id, house.id]);
  if (dup) {
    console.log(`  · ${user.name} 은(는) 이미 ${house.name} 담당입니다 (${dup.vf} 부터)`);
    return false;
  }
  if (!DRY) {
    await q(`INSERT INTO sec.user_scope (user_id, farm_id, house_id, valid_from)
             VALUES ($1,$2,$3,$4::date)`, [user.id, house.farm_id, house.id, from]);
    await audit(user.id, `${house.code} 담당 지정 (${from} 부터)`);
  }
  console.log(`  + ${user.name} → ${house.name} 담당 (${from} 부터)`);
  return true;
}

/** 돈사 하나의 담당을 통째로 넘긴다. 지금 열려 있는 담당은 전부 닫는다. */
async function move(code, toLoginId, from) {
  const house = await findHouse(code);
  const to = await findUser(toLoginId);

  const holders = await q(`
    SELECT u.id, u.login_id, u.name FROM sec.user_scope us
      JOIN sec.app_user u ON u.id = us.user_id
     WHERE us.house_id = $1 AND us.valid_to IS NULL`, [house.id]);

  console.log(`\n━━ ${house.name} 담당 교체 (${from} 부터) ━━`);
  for (const h of holders) {
    if (h.id === to.id) continue;
    await endScope(h, house, from);
  }
  await addScope(to, house, from);
}

// ── 실행 ──────────────────────────────────────────────────────────────
try {
  await client.query('BEGIN');

  if (flag('move')) {
    const target = opt('to');
    if (!target) throw new Error('--move 에는 --to <계정> 이 필요합니다.');
    await move(opt('move'), target, FROM);
  } else if (flag('add') || flag('end')) {
    const user = await findUser(opt('user'));
    const house = await findHouse(opt('house'));
    console.log(`\n━━ ${flag('add') ? '담당 추가' : '담당 해제'} (${FROM} 부터) ━━`);
    if (flag('add')) await addScope(user, house, FROM);
    else await endScope(user, house, FROM);
  } else if (opt('user')) {
    await history(opt('user'));
  } else if (opt('house')) {
    await houseHistory(opt('house'));
  } else {
    await report();
  }

  if (DRY) {
    await client.query('ROLLBACK');
    console.log('\n--dry — 아무것도 바꾸지 않았습니다.');
  } else {
    await client.query('COMMIT');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\n실패 — 롤백했습니다.\n  ' + e.message);
  await client.end();
  process.exit(1);
}

// 바꿨으면 결과를 한 번 더 보여 준다 — 담당 없는 돈사가 생겼는지 확인한다
if (flag('move') || flag('add') || flag('end')) await report();
await client.end();
