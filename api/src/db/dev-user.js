/**
 * 화면을 눌러 보기 위한 임시 계정 — 개발용
 *
 * 운영 계정(`seed:users`)의 비밀번호는 한 번 찍고 버린다. 화면을 고칠 때마다
 * 그걸 다시 발급하면 현장에 나간 비밀번호가 무효가 된다. 그래서 눌러 보기용
 * 계정을 따로 둔다 — 이름이 `dev.` 로 시작하고, 끝나면 지운다.
 *
 *   node src/db/dev-user.js            dev.lead · dev.hq 발급 (비밀번호 출력)
 *   node src/db/dev-user.js --drop     둘 다 삭제
 *
 * NODE_ENV=production 이면 거부한다.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../config.js';
import { hashPassword, generatePassword } from '../auth/password.js';

if (config.env === 'production') {
  console.error('운영 환경에서는 쓸 수 없습니다.');
  process.exit(1);
}

const drop = process.argv.includes('--drop');

// dev.lead 는 분만사 담당 팀장 — 돈방 × 축종 돈사라 그리드가 가장 복잡하다.
const PEOPLE = [
  { loginId: 'dev.lead', name: '개발 팀장', role: 'team_lead',
    houses: ['BUNMAN1'], note: '분만사 1동' },
  { loginId: 'dev.hq', name: '개발 본사', role: 'hq_staff', houses: [], note: '전 돈사 · 확정' },
];

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
  application_name: 'buyeogp-dev-user',
});
await client.connect();

if (drop) {
  const r = await client.query(
    `DELETE FROM sec.app_user WHERE login_id LIKE 'dev.%' RETURNING login_id`);
  console.log(r.rowCount ? `삭제: ${r.rows.map((x) => x.login_id).join(', ')}` : '지울 것이 없습니다.');
  await client.end();
  process.exit(0);
}

const farm = (await client.query(`SELECT id FROM app.farm WHERE code='BUYEO'`)).rows[0];
const issued = [];

await client.query('BEGIN');
try {
  for (const p of PEOPLE) {
    await client.query('DELETE FROM sec.app_user WHERE login_id = $1', [p.loginId]);
    const pw = generatePassword();
    const id = (await client.query(
      `INSERT INTO sec.app_user (login_id, name, password_hash, status, nationality, mfa_required)
       VALUES ($1,$2,$3,'active','KR',false) RETURNING id`,
      [p.loginId, p.name, await hashPassword(pw)])).rows[0].id;

    await client.query('INSERT INTO sec.user_role (user_id, role) VALUES ($1,$2)', [id, p.role]);
    if (p.houses.length) {
      await client.query(
        `INSERT INTO sec.user_scope (user_id, farm_id, house_id)
         SELECT $1, h.farm_id, h.id FROM app.house h WHERE h.code = ANY($2)`, [id, p.houses]);
    } else {
      await client.query(
        'INSERT INTO sec.user_scope (user_id, farm_id, house_id) VALUES ($1,$2,NULL)',
        [id, farm.id]);
    }
    issued.push({ ...p, password: pw });
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('실패 — 롤백했습니다.', e.message);
  process.exit(1);
}

console.log('\n━━ 눌러 보기용 계정 ━━');
for (const p of issued) {
  console.log(`  ${p.loginId.padEnd(9)} ${p.password.padEnd(16)} ${p.name} (${p.note})`);
}
console.log('\n끝나면 node src/db/dev-user.js --drop');
await client.end();
