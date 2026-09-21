/**
 * 계정 관리용 접속 계정 생성 + SoD-3 실제 확인
 *
 * 계정 관리 화면은 `buyeogp_admin` 으로 붙는다. 업무 화면이 쓰는 `buyeogp_api`
 * 와 **다른 연결**이다. 그래야 「계정을 고치는 코드가 일보를 읽을 수 없다」가
 * 코드 규약이 아니라 DB 가 강제하는 사실이 된다 (SoD-3).
 *
 * 만든 뒤 그 계정으로 직접 붙어 일보가 정말 안 보이는지 본다 —
 * GRANT 를 안 했다는 것과 실제로 막힌다는 것은 별개이고, 시켜 봐야 안다.
 *
 * 사용: node src/db/setup-admin-role.js [--rotate]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const ENV_PATH = path.join(ROOT, 'infra', '.env');

let envText = await readFile(ENV_PATH, 'utf8');
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
  ssl: { rejectUnauthorized: false }, application_name: 'buyeogp-admin-role',
});

const owner = conn(env.DB_MIGRATE_USER, env.DB_MIGRATE_PASSWORD);
await owner.connect();

const exists = (await owner.query(
  `select 1 from pg_roles where rolname='buyeogp_adm'`)).rowCount > 0;

let pw = env.DB_ADMIN_PASSWORD;
if (!exists || process.argv.includes('--rotate') || !pw) {
  pw = randomBytes(24).toString('base64url');
  if (exists) {
    await owner.query(`ALTER ROLE buyeogp_adm WITH PASSWORD '${pw}'`);
    console.log('  · buyeogp_adm 비밀번호를 새로 발급했습니다');
  } else {
    await owner.query(`CREATE ROLE buyeogp_adm LOGIN PASSWORD '${pw}' IN ROLE buyeogp_admin`);
    console.log('  · buyeogp_adm 계정을 만들었습니다 (buyeogp_admin 소속)');
  }
  // 그룹 역할의 search_path 는 상속되지 않는다
  await owner.query(`ALTER ROLE buyeogp_adm SET search_path = sec, app, extensions, public`);

  const line = (k, v) => new RegExp(`^${k}=.*$`, 'm').test(envText)
    ? (envText = envText.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`))
    : (envText += `\n${k}=${v}\n`);
  line('DB_ADMIN_USER', `buyeogp_adm.${REF}`);
  line('DB_ADMIN_PASSWORD', pw);
  await writeFile(ENV_PATH, envText, 'utf8');
  console.log('  · infra/.env 에 DB_ADMIN_USER / DB_ADMIN_PASSWORD 를 적었습니다');
} else {
  console.log('  · buyeogp_adm 이 이미 있습니다 (--rotate 로 비밀번호 재발급)');
}
await owner.end();

// ── SoD-3 이 실제로 걸리는지 ─────────────────────────────────────────
console.log('\n━━ SoD-3 실제 확인 ━━');
const adm = conn(`buyeogp_adm.${REF}`, pw);
try {
  await adm.connect();
} catch (e) {
  console.error(`  접속 실패: ${e.message}`);
  process.exit(1);
}

let pass = 0, fail = 0;
const ck = (n, ok, d = '') => {
  if (ok) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.log(`  ✗ ${n}  ${d}`); }
};

const denied = async (label, sql) => {
  try {
    await adm.query(sql);
    ck(label, false, '거부되지 않았다');
  } catch (e) {
    ck(label, /permission denied|does not exist/i.test(e.message), e.message.slice(0, 60));
  }
};

// 막혀야 하는 것 — 업무 데이터
await denied('일보 읽기 거부',      'select 1 from app.daily_report limit 1');
await denied('두수 읽기 거부',      'select 1 from app.pen_daily limit 1');
await denied('폐사 읽기 거부',      'select 1 from app.mortality limit 1');
await denied('일보 쓰기 거부',
  `insert into app.daily_report (farm_id,house_id,report_date,status) values (1,1,'2099-01-01','draft')`);

// 감사로그는 append-only 다. 규칙(DO INSTEAD NOTHING)이 UPDATE·DELETE 를
// **조용한 무동작**으로 만든다 — 오류가 나지 않으니 「안 바뀌었는지」를 봐야 한다.
{
  const { rows: [row] } = await adm.query(
    `insert into sec.audit_log (action, table_name, detail)
     values ('UPDATE','sec.audit_log','append-only 확인 원본') returning id`);
  await adm.query(`update sec.audit_log set detail = '고쳐졌다' where id = $1`, [row.id]);
  await adm.query(`delete from sec.audit_log where id = $1`, [row.id]);
  const { rows: [after] } = await adm.query(
    `select detail from sec.audit_log where id = $1`, [row.id]);
  ck('감사로그는 고쳐지지도 지워지지도 않는다',
    after && after.detail === 'append-only 확인 원본',
    after ? `detail=${after.detail}` : '행이 사라졌다');
}

// 열려야 하는 것 — 계정·담당·마스터 이름
const can = async (label, sql) => {
  try { await adm.query(sql); ck(label, true); }
  catch (e) { ck(label, false, e.message.slice(0, 70)); }
};
await can('계정 읽기',       'select 1 from sec.app_user limit 1');
await can('담당 읽기/쓰기',  'select 1 from sec.user_scope limit 1');
await can('돈사 이름 읽기',  'select code, name from app.house limit 1');
await can('담당 현황 뷰',    'select * from sec.v_house_owner limit 1');
await can('감사로그 기록',   `insert into sec.audit_log (action, table_name, detail)
                              values ('UPDATE','sec.user_scope','setup-admin-role 확인')`);

await adm.end();
console.log(`\n  통과 ${pass} · 실패 ${fail}`);
if (fail) {
  console.log('\n  SoD-3 이 깨졌습니다. 021_admin_grants.sql 을 확인하십시오.');
  process.exit(1);
}
console.log('\n계정 관리 연결이 준비됐습니다. 업무 데이터는 이 연결로 보이지 않습니다.');
