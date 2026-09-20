/**
 * 앱 접속 계정 생성 + RLS 실제 적용 확인 — 런북 3단계
 *
 * 스키마는 권한만 담은 그룹 역할(buyeogp_app)을 만든다. 실제 로그인 계정은
 * 여기 소속시켜 따로 만든다 — 비밀번호가 저장소에 들어가지 않게 하려는 것이다.
 *
 * 만든 뒤 그 계정으로 직접 붙어 RLS 가 정말 걸리는지 본다.
 * 마이그레이션은 소유자(postgres)로 돌기 때문에 RLS 를 우회한다. 그래서
 * 「정책을 만들었다」와 「정책이 작동한다」는 별개이고, 확인해야 안다.
 *
 * 사용: node src/db/setup-app-role.js [--rotate]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ENV_PATH = path.join(ROOT, 'infra', '.env');

const envText = await readFile(ENV_PATH, 'utf8');
const env = {};
for (const l of envText.split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const REF = (env.DB_MIGRATE_USER || '').split('.')[1];
if (!REF) throw new Error('DB_MIGRATE_USER 가 postgres.⟨ref⟩ 형식이어야 합니다.');

const conn = (user, password) => new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
  user, password, database: env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false }, application_name: 'buyeogp-role',
});

const admin = conn(env.DB_MIGRATE_USER, env.DB_MIGRATE_PASSWORD);
await admin.connect();

const exists = (await admin.query(
  `select 1 from pg_roles where rolname='buyeogp_api'`)).rowCount > 0;

let pw = env.DB_PASSWORD;
if (!exists || process.argv.includes('--rotate') || !pw) {
  pw = randomBytes(24).toString('base64url');
  if (exists) {
    await admin.query(`ALTER ROLE buyeogp_api WITH PASSWORD '${pw}'`);
    console.log('  · buyeogp_api 비밀번호를 새로 발급했습니다');
  } else {
    await admin.query(`CREATE ROLE buyeogp_api LOGIN PASSWORD '${pw}' IN ROLE buyeogp_app`);
    console.log('  · buyeogp_api 계정을 만들었습니다 (buyeogp_app 소속)');
  }
  // 그룹 역할에 건 search_path 는 상속되지 않는다. 로그인 계정에 따로 걸어야 한다.
  await admin.query(
    `ALTER ROLE buyeogp_api SET search_path = app, sec, extensions, public`);

  const next = envText.replace(/^DB_PASSWORD=.*$/m, `DB_PASSWORD=${pw}`);
  await writeFile(ENV_PATH, next, 'utf8');
  console.log('  · infra/.env 의 DB_PASSWORD 를 갱신했습니다');
} else {
  console.log('  · buyeogp_api 가 이미 있습니다 (--rotate 로 비밀번호 재발급)');
}
await admin.end();

// ── RLS 가 실제로 걸리는지 ───────────────────────────────────────────
console.log('\n━━ RLS 실제 적용 확인 ━━');
const app = conn(`buyeogp_api.${REF}`, pw);
try {
  await app.connect();
} catch (e) {
  console.error(`  접속 실패: ${e.message}`);
  process.exit(1);
}

const who = (await app.query('select current_user, current_setting($1,true) as uid',
  ['app.user_id'])).rows[0];
console.log(`  접속 계정 ${who.current_user} · app.user_id ${who.uid ?? '(미설정)'}`);

let pass = 0, fail = 0;
const ck = (n, ok, d = '') => {
  if (ok) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.log(`  ✗ ${n}  ${d}`); }
};

// 신원을 알리지 않으면 아무것도 보이지 않아야 한다
const blind = (await app.query('select count(*)::int n from app.pen_daily')).rows[0].n;
ck('신원 미설정 시 일보 0행', blind === 0, `실제 ${blind}행이 보인다`);
const blindPen = (await app.query('select count(*)::int n from app.pen')).rows[0].n;
ck('신원 미설정 시 돈방 0행', blindPen === 0, `실제 ${blindPen}행`);

// 스코프를 준 사용자로는 보여야 한다
await app.query('BEGIN');
try {
  const u = (await app.query(`select id from sec.app_user where login_id='system.m3'`)).rows[0];
  if (u) {
    // 이 계정은 sec 에 쓰기 권한이 없으므로 스코프 부여는 확인만 한다
    const scoped = (await app.query(
      `select count(*)::int n from sec.user_scope where user_id=$1`, [u.id])).rows[0].n;
    console.log(`  · system.m3 의 스코프 ${scoped}건 (없으면 0행이 정상)`);
    await app.query(`select set_config('app.user_id',$1,true)`, [u.id]);
    const seen = (await app.query('select count(*)::int n from app.pen')).rows[0].n;
    ck('스코프 없는 사용자도 0행', seen === 0, `실제 ${seen}행`);
  }
} finally {
  await app.query('ROLLBACK');
}

// 쓰기 권한 경계
await app.query('BEGIN');
try {
  await app.query(`insert into sec.app_user (login_id,name,password_hash)
                   values ('should.fail','x','!')`);
  ck('sec.app_user 쓰기 거부', false, '거부되지 않았다');
} catch {
  ck('sec.app_user 쓰기 거부', true);
} finally {
  await app.query('ROLLBACK');
}

const auditW = await app.query(`select has_table_privilege('sec.audit_log','UPDATE') as u,
                                       has_table_privilege('sec.audit_log','DELETE') as d`);
ck('감사로그 UPDATE·DELETE 권한 없음', !auditW.rows[0].u && !auditW.rows[0].d);

console.log(`\n  통과 ${pass} · 실패 ${fail}`);
await app.end();
process.exit(fail ? 1 : 0);
