/**
 * 계정 발급 — 설계문서 §6.1 (조직도 26.07.20판)
 *
 * 1단계 발급 대상은 L2 이상 7명이다.
 * 비밀번호는 난수로 만들어 화면에 한 번 찍고 저장하지 않는다 —
 * 저장소에도, 로그에도 남기지 않는다. 받아서 전달하고 첫 로그인에 바꾸게 한다.
 *
 * 사용
 *   node src/db/seed-users.js            없는 계정만 만든다
 *   node src/db/seed-users.js --reset    비밀번호를 전부 새로 발급한다
 */
import pg from 'pg';
import { config } from '../config.js';
import { hashPassword, generatePassword } from '../auth/password.js';

// 조직도 기준. 스코프는 돈사 코드로 적는다 — 빈 배열이면 농장 전체
const PEOPLE = [
  { loginId: 'baedu',   name: '배두',       role: 'team_lead',
    houses: ['JONGBU', 'IMSIN1', 'IMSIN2', 'SUNCHI'], note: '종부·임신·순치' },
  { loginId: 'ham',     name: '햄',         role: 'team_lead',
    houses: ['BUNMAN1', 'BUNMAN2'], note: '분만' },
  { loginId: 'raju',    name: '라주',       role: 'team_lead',
    houses: ['JADON'], note: '초기자돈' },
  { loginId: 'pemba',   name: '펨바',       role: 'team_lead',
    houses: ['YUKSUNG', 'BIYUK_M', 'BIYUK_F', 'GEOMJUNG'], note: '육성·비육·검정' },
  { loginId: 'choi.ij', name: '최임재 부장', role: 'farm_manager',
    houses: [], note: '현장 총괄' },
  { loginId: 'shin.dw', name: '신동욱 과장', role: 'farm_manager',
    houses: ['YUKSUNG', 'BIYUK_M', 'BIYUK_F', 'GEOMJUNG'], note: '육성·비육·검정' },
  { loginId: 'hq.staff', name: '본사 팀장',  role: 'hq_staff',
    houses: [], note: '확정' },
  { loginId: 'hq.mgr',   name: '본사 실장',  role: 'hq_manager',
    houses: [], note: '정정 승인·마감' },
];

const reset = process.argv.includes('--reset');

// 계정 생성은 sec 스키마에 쓰므로 **소유자**로 붙는다. buyeogp_api 는 쓰기 권한이 없다.
// pg.Client 는 생성 시점의 설정을 복사하므로 값을 먼저 다 모은 뒤 만든다.
const { readFileSync } = await import('node:fs');
const path = await import('node:path');
const { ROOT } = await import('../config.js');
const envFile = {};
try {
  for (const l of readFileSync(path.join(ROOT, 'infra', '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) envFile[m[1]] = m[2].trim();
  }
} catch { /* .env 가 없으면 환경 변수를 쓴다 */ }

const owner = {
  user: process.env.DB_MIGRATE_USER ?? envFile.DB_MIGRATE_USER,
  password: process.env.DB_MIGRATE_PASSWORD ?? envFile.DB_MIGRATE_PASSWORD,
};
if (!owner.user || !owner.password) {
  console.error('DB_MIGRATE_USER / DB_MIGRATE_PASSWORD 가 필요합니다 (infra/.env).');
  process.exit(1);
}

const client = new pg.Client({
  host: config.db.host, port: config.db.port,
  user: owner.user, password: owner.password,
  database: config.db.database, ssl: config.db.ssl,
  application_name: 'buyeogp-seed-users',
});

await client.connect();
const farm = (await client.query(`SELECT id FROM app.farm WHERE code='BUYEO'`)).rows[0];
if (!farm) { console.error('농장 마스터가 없습니다. 먼저 스키마를 올리십시오.'); process.exit(1); }

const issued = [];
try {
  await client.query('BEGIN');
  for (const p of PEOPLE) {
    const exist = (await client.query(
      'SELECT id FROM sec.app_user WHERE login_id = $1', [p.loginId])).rows[0];
    if (exist && !reset) { console.log(`  · ${p.loginId.padEnd(9)} 이미 있음`); continue; }

    const pw = generatePassword();
    const hash = await hashPassword(pw);
    let id;
    if (exist) {
      await client.query('UPDATE sec.app_user SET password_hash=$2 WHERE id=$1', [exist.id, hash]);
      id = exist.id;
    } else {
      id = (await client.query(
        `INSERT INTO sec.app_user (login_id, name, password_hash, status, nationality, mfa_required)
         VALUES ($1,$2,$3,'active',$4,$5) RETURNING id`,
        [p.loginId, p.name, hash,
         ['baedu', 'ham', 'raju', 'pemba'].includes(p.loginId) ? 'NP' : 'KR',
         p.role.startsWith('hq_')])).rows[0].id;
    }

    await client.query(
      `INSERT INTO sec.user_role (user_id, role) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`, [id, p.role]);

    if (p.houses.length === 0) {
      await client.query(
        `INSERT INTO sec.user_scope (user_id, farm_id, house_id) VALUES ($1,$2,NULL)
         ON CONFLICT DO NOTHING`, [id, farm.id]);
    } else {
      await client.query(
        `INSERT INTO sec.user_scope (user_id, farm_id, house_id)
         SELECT $1, h.farm_id, h.id FROM app.house h WHERE h.code = ANY($2)
         ON CONFLICT DO NOTHING`, [id, p.houses]);
    }
    issued.push({ ...p, password: pw });
    console.log(`  ✓ ${p.loginId.padEnd(9)} ${p.name}`);
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('실패 — 롤백했습니다.', e.message);
  process.exit(1);
}

if (issued.length) {
  console.log('\n━━ 발급된 비밀번호 ━━');
  console.log('이 화면에만 나옵니다. 저장소·로그에 남지 않습니다.\n');
  for (const p of issued) {
    console.log(`  ${p.loginId.padEnd(10)} ${p.password.padEnd(16)} ${p.name} (${p.note})`);
  }
  console.log('\n전달한 뒤 첫 로그인에서 바꾸게 하십시오.');
} else {
  console.log('\n새로 발급한 계정이 없습니다. (--reset 으로 비밀번호 재발급)');
}

const sum = (await client.query(`
  SELECT u.login_id, u.name, string_agg(DISTINCT r.role::text, ',') AS roles,
         count(DISTINCT s.house_id)::int AS houses,
         bool_or(s.house_id IS NULL) AS farm_wide
    FROM sec.app_user u
    LEFT JOIN sec.user_role r ON r.user_id = u.id
    LEFT JOIN sec.user_scope s ON s.user_id = u.id
   WHERE u.login_id NOT LIKE 'system.%'
   GROUP BY u.login_id, u.name ORDER BY u.login_id`)).rows;
console.log('\n━━ 계정 현황 ━━');
console.table(sum.map((r) => ({
  계정: r.login_id, 이름: r.name, 역할: r.roles,
  담당: r.farm_wide ? '전 돈사' : `${r.houses}개 돈사`,
})));

await client.end();
