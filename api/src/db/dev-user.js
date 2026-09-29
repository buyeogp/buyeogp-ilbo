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

// 이름을 「[시험]」으로 시작하게 둔다. 담당 표와 감사로그에서 배두·햄·라주·펨바
// 옆에 나란히 서기 때문에, 현장 사람으로 읽히면 안 된다.
// 감사로그는 지울 수 없으므로 여기 남긴 이름이 영구히 남는다.
//
// dev.lead 는 분만사 담당 — 돈방 × 축종 돈사라 그리드가 가장 복잡하다.
const PEOPLE = [
  { loginId: 'dev.lead', name: '[시험] 팀장', role: 'team_lead',
    houses: ['BUNMAN1'], note: '분만사 1동' },
  { loginId: 'dev.hq', name: '[시험] 본사', role: 'hq_staff', houses: [], note: '전 돈사 · 확정' },
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
  // 시험 계정으로 눌러 본 일보가 남아 있으면 계정을 지울 수 없다 (작성자 FK).
  // 작성 중(draft)인 것만 함께 지운다. 제출·확정까지 간 것은 기록이라 멈추고 알린다.
  await client.query('BEGIN');
  try {
    const ids = (await client.query(
      `SELECT id FROM sec.app_user WHERE login_id LIKE 'dev.%'`)).rows.map((r) => r.id);
    const kept = (await client.query(
      `SELECT h.name, r.report_date::text AS d, r.status
         FROM app.daily_report r JOIN app.house h ON h.id = r.house_id
        WHERE r.status <> 'draft'
          AND (r.author_id = ANY($1) OR r.confirmed_by = ANY($1) OR r.field_writer_id = ANY($1))`,
      [ids])).rows;
    if (kept.length) {
      console.error('시험 계정이 제출·확정한 일보가 있어 멈춥니다 — 정정 절차로 처리하십시오:');
      for (const k of kept) console.error(`  ${k.name} ${k.d} (${k.status})`);
      throw new Error('지우지 않았습니다');
    }
    const drafts = await client.query(
      `DELETE FROM app.daily_report WHERE status = 'draft' AND author_id = ANY($1)
       RETURNING report_date::text AS d`, [ids]);
    // 폐사·도태 원장도 작성자로 계정을 문다. 일보를 먼저 지웠으므로 원장을 지워도
    // 재계산할 일보 행이 없다 (순서를 바꾸면 확정 일보 행을 건드려 P4 에 걸린다)
    const dead = await client.query(
      'DELETE FROM app.mortality WHERE created_by = ANY($1) RETURNING id', [ids]);
    const culled = await client.query(
      'DELETE FROM app.culling WHERE created_by = ANY($1) RETURNING id', [ids]);
    if (dead.rowCount + culled.rowCount) {
      console.log(`폐사 ${dead.rowCount}건 · 도태 ${culled.rowCount}건 삭제`);
    }
    const r = await client.query(
      `DELETE FROM sec.app_user WHERE id = ANY($1) RETURNING login_id`, [ids]);
    await client.query('COMMIT');
    if (drafts.rowCount) console.log(`작성 중 일보 ${drafts.rowCount}건 삭제 (${drafts.rows.map((x) => x.d).join(', ')})`);
    console.log(r.rowCount ? `삭제: ${r.rows.map((x) => x.login_id).join(', ')}` : '지울 것이 없습니다.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 롤백했습니다.', e.message);
    process.exitCode = 1;
  }
  await client.end();
  process.exit();
}

const farm = (await client.query(`SELECT id FROM app.farm WHERE code='BUYEO'`)).rows[0];
const issued = [];

await client.query('BEGIN');
try {
  for (const p of PEOPLE) {
    const pw = generatePassword();
    // 이미 있으면 비밀번호만 새로 준다. 지우고 다시 만들면 그 계정으로 눌러 본
    // 일보(작성자 FK) 때문에 실패하고, 담당 이력도 사라진다
    const had = await client.query(
      `UPDATE sec.app_user SET password_hash = $2, status = 'active' WHERE login_id = $1 RETURNING id`,
      [p.loginId, await hashPassword(pw)]);
    if (had.rowCount) { issued.push({ ...p, password: pw }); continue; }
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
