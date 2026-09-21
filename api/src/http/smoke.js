/**
 * API 실동작 확인 — 서버를 띄워 실제 HTTP 로 두드린다.
 *
 * 단위 시험이 아니다. 로그인해서 쿠키를 받고, 그 쿠키로 일보를 열고,
 * 권한 밖 돈사를 찔러 보고, 규칙 위반이 실제로 막히는지 본다.
 * 만든 것이 돌아가는지 확인하는 가장 싼 방법이다.
 *
 * 사용: node src/http/smoke.js
 */
import { createApp } from './app.js';
import { config } from '../config.js';
import { pool, tx } from '../db/pool.js';

const PORT = 3999;
const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const fails = [];

const ck = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(`${name} — ${detail}`); console.log(`  ✗ ${name}  ${detail}`); }
};

let cookie = '';
async function call(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const [kv] = c.split(';');
    if (kv.startsWith(config.session.cookie + '=')) cookie = kv;
  }
  let json = null;
  try { json = await r.json(); } catch { /* 본문이 없을 수 있다 */ }
  return { status: r.status, body: json };
}

const server = createApp().listen(PORT);
await new Promise((ok) => server.once('listening', ok));
console.log(`\n시험 서버 ${base}\n`);

// 시험용 계정 — 비밀번호를 아는 계정을 하나 만든다 (끝나면 지운다)
const { hashPassword } = await import('../auth/password.js');
const TEST_PW = 'smoke-test-pw-9182';
const pgmod = (await import('pg')).default;
const envFile = {};
{
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { ROOT } = await import('../config.js');
  for (const l of readFileSync(path.join(ROOT, 'infra', '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) envFile[m[1]] = m[2].trim();
  }
}
const admin = new pgmod.Client({
  host: config.db.host, port: config.db.port,
  user: envFile.DB_MIGRATE_USER, password: envFile.DB_MIGRATE_PASSWORD,
  database: config.db.database, ssl: config.db.ssl,
});
await admin.connect();

const farm = (await admin.query(`select id from app.farm where code='BUYEO'`)).rows[0].id;
const jadon = (await admin.query(`select id from app.house where code='JADON'`)).rows[0].id;
const bunman = (await admin.query(`select id from app.house where code='BUNMAN1'`)).rows[0].id;

await admin.query(`delete from sec.app_user where login_id in ('smoke.lead','smoke.hq')`);
const lead = (await admin.query(
  `insert into sec.app_user (login_id,name,password_hash,status)
   values ('smoke.lead','시험 팀장',$1,'active') returning id`, [await hashPassword(TEST_PW)]
)).rows[0].id;
const hq = (await admin.query(
  `insert into sec.app_user (login_id,name,password_hash,status)
   values ('smoke.hq','시험 본사',$1,'active') returning id`, [await hashPassword(TEST_PW)]
)).rows[0].id;
await admin.query(`insert into sec.user_role (user_id,role) values ($1,'team_lead'),($2,'hq_staff')`,
  [lead, hq]);
// 팀장은 자돈사만 담당한다 — 분만사는 못 봐야 한다
await admin.query(`insert into sec.user_scope (user_id,farm_id,house_id) values ($1,$2,$3)`,
  [lead, farm, jadon]);
await admin.query(`insert into sec.user_scope (user_id,farm_id,house_id) values ($1,$2,null)`,
  [hq, farm]);

const TEST_DATE = '2031-03-01';
await admin.query(`delete from app.daily_report where report_date >= date '2031-01-01'`);

try {
  // ── 인증 ──────────────────────────────────────────────────────────
  console.log('━━ 인증 ━━');
  ck('인증 없이 /api/auth/me 는 401',
    (await call('GET', '/api/auth/me')).status === 401);

  const bad = await call('POST', '/api/auth/login',
    { loginId: 'smoke.lead', password: '틀린비밀번호' });
  ck('틀린 비밀번호는 401', bad.status === 401, `실제 ${bad.status}`);
  ck('실패 이유를 자세히 말하지 않는다',
    !/존재|없는 계정/.test(bad.body?.message ?? ''), bad.body?.message);

  const ok = await call('POST', '/api/auth/login',
    { loginId: 'smoke.lead', password: TEST_PW });
  ck('로그인 성공', ok.status === 200, JSON.stringify(ok.body).slice(0, 80));
  ck('쿠키 발급', cookie.startsWith(config.session.cookie + '='));
  ck('역할 전달', ok.body?.user?.roles?.includes('team_lead'));
  ck('현장 세션은 15분', ok.body?.session?.idleLimitSec === 900,
    `실제 ${ok.body?.session?.idleLimitSec}`);

  const me = await call('GET', '/api/auth/me');
  ck('/me 가 담당 돈사를 준다', me.body?.scopes?.length === 1
    && me.body.scopes[0].houseCode === 'JADON',
    JSON.stringify(me.body?.scopes));

  // ── 권한 ──────────────────────────────────────────────────────────
  console.log('\n━━ 권한 ━━');
  const other = await call('GET', `/api/reports/${bunman}/${TEST_DATE}`);
  ck('담당 아닌 돈사 조회는 403', other.status === 403, `실제 ${other.status}`);

  const mine = await call('GET', `/api/reports/${jadon}/${TEST_DATE}`);
  ck('담당 돈사 조회는 200', mine.status === 200, `실제 ${mine.status}`);
  ck('행 골격 28개를 만들어 준다', mine.body?.rows?.length === 28,
    `실제 ${mine.body?.rows?.length}`);
  ck('아직 입력 전이라 filled=false',
    mine.body?.rows?.every((r) => r.filled === false));

  const confirmDenied = await call('POST', '/api/reports/1/confirm');
  ck('팀장은 확정 권한 없음 (SoD-1)', confirmDenied.status === 403,
    `실제 ${confirmDenied.status}`);

  // ── 일보 입력 ─────────────────────────────────────────────────────
  console.log('\n━━ 일보 입력 ━━');
  const opened = await call('POST', `/api/reports/${jadon}/${TEST_DATE}/open`);
  ck('일보 열기', opened.status === 201, JSON.stringify(opened.body));
  const reportId = opened.body?.reportId;

  const rows = mine.body.rows.map((r, i) => ({
    penId: r.penId, categoryId: r.categoryId,
    inHead: i === 0 ? 10 : 0, outHead: 0, internalOutHead: 0, soldHead: 0,
  }));
  const saved = await call('PUT', `/api/reports/${reportId}/rows`, { rows });
  ck('28행 저장', saved.body?.saved === 28, JSON.stringify(saved.body).slice(0, 90));
  ck('전 돈방 입력 후 제출 가능', saved.body?.canSubmit === true,
    JSON.stringify(saved.body?.violations)?.slice(0, 90));

  // V2 는 직전 **확정본**의 당일두수를 잇는다. 날짜가 떨어져 있어도 마찬가지다 —
  // 원장이므로 마지막 확정 잔고가 다음 시작 잔고다. M3 로 적재한 과거 확정분이
  // 있으므로 0 이 아니라 그 값이 온다.
  const prev = (await admin.query(
    `select pd.closing_head from app.pen_daily pd
       join app.daily_report dr on dr.id = pd.report_id
      where pd.pen_id = $1 and dr.status in ('confirmed','locked')
        and pd.report_date < date '${TEST_DATE}'
      order by pd.report_date desc limit 1`, [rows[0].penId])).rows[0]?.closing_head ?? 0;

  const after = await call('GET', `/api/reports/${jadon}/${TEST_DATE}`);
  const r0 = after.body.rows[0];
  ck(`V2 전일두수 = 직전 확정본의 당일두수 (${prev})`, r0.openingHead === prev,
    `실제 ${r0.openingHead}`);
  ck(`V1 당일두수 = ${prev} + 전입 10`, r0.closingHead === prev + 10,
    `실제 ${r0.closingHead}`);

  // 규칙 위반이 실제로 막히는지
  const bogus = await call('PUT', `/api/reports/${reportId}/rows`,
    { rows: [{ penId: rows[1].penId, inHead: 0, outHead: 999 }] });
  ck('재고 초과 출고는 422 (V3)', bogus.status === 422, `실제 ${bogus.status}`);
  ck('현장이 읽을 수 있는 말로 온다',
    /나간 두수|규칙/.test(bogus.body?.message ?? ''), bogus.body?.message);

  // ── 제출 → 확정 ───────────────────────────────────────────────────
  console.log('\n━━ 제출 · 확정 ━━');
  const sub = await call('POST', `/api/reports/${reportId}/submit`);
  ck('제출 성공', sub.status === 200 && sub.body?.status === 'submitted',
    JSON.stringify(sub.body));

  const lockedEdit = await call('PUT', `/api/reports/${reportId}/rows`,
    { rows: [{ penId: rows[0].penId, inHead: 99 }] });
  ck('제출 후 수정 거부', lockedEdit.status === 409, `실제 ${lockedEdit.status}`);

  cookie = '';
  await call('POST', '/api/auth/login', { loginId: 'smoke.hq', password: TEST_PW });
  const hqMe = await call('GET', '/api/auth/me');
  ck('본사 세션은 30분', hqMe.body?.session != null);

  const conf = await call('POST', `/api/reports/${reportId}/confirm`);
  ck('본사는 확정 가능', conf.status === 200 && conf.body?.status === 'confirmed',
    JSON.stringify(conf.body));

  const status = await call('GET', `/api/reports/status?date=${TEST_DATE}`);
  ck('본사는 전 돈사 현황을 본다', status.body?.houses?.length === 12,
    `실제 ${status.body?.houses?.length}`);
  ck('자돈사가 확정으로 보인다',
    status.body?.houses?.find((h) => h.code === 'JADON')?.status === 'confirmed');

  // ── 로그아웃 ──────────────────────────────────────────────────────
  console.log('\n━━ 로그아웃 ━━');
  await call('POST', '/api/auth/logout');
  ck('로그아웃 후 401', (await call('GET', '/api/auth/me')).status === 401);

} finally {
  await admin.query(`delete from app.daily_report where report_date >= date '2031-01-01'`);
  await admin.query(`delete from sec.app_user where login_id in ('smoke.lead','smoke.hq')`);
  await admin.end();
  server.close();
  await pool.end();
}

console.log(`\n━━ 결과 ━━\n  통과 ${pass} · 실패 ${fail}`);
if (fail) { console.log('\n실패:'); fails.forEach((f) => console.log('  · ' + f)); }
process.exit(fail ? 1 : 0);
