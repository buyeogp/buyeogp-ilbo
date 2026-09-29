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

// 시험이 남긴 것 지우기. 순서가 있다 — 일보를 먼저 지워야 한다.
// 폐사·도태를 먼저 지우면 원장 재계산이 **확정된** 시험 일보 행을 고치려다 P4 에 걸린다.
// 원장은 시험 계정을 작성자로 물고 있으므로 계정보다는 먼저 지운다.
async function clearTestData() {
  await admin.query(`delete from app.daily_report where report_date >= date '2031-01-01'`);
  await admin.query(`delete from app.mortality where event_date >= date '2031-01-01'`);
  await admin.query(`delete from app.culling where event_date >= date '2031-01-01'`);
}
await clearTestData();          // 지난번 시험이 중간에 멈췄을 수 있다
await admin.query(`delete from sec.app_user where login_id in ('smoke.lead','smoke.hq','smoke.new','smoke.bad')`);
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

  // 그리드는 저장 전에도 전일두수를 보여 줘야 한다(§8.1). 조회 API 가 V2 와 같은
  // 규칙으로 미리 계산해서 내려보내는데, 그 예상과 실제가 어긋나면 화면의 숫자가
  // 저장하는 순간 바뀐다 — 현장이 가장 못 믿게 되는 종류의 버그다.
  ck('저장 전 예상 전일두수 = 저장 후 실제 전일두수',
    mine.body.rows.every((r, i) => r.expectedOpeningHead === after.body.rows[i].openingHead),
    `${mine.body.rows.filter((r, i) => r.expectedOpeningHead !== after.body.rows[i].openingHead).length}행 불일치`);

  // ── 폐사·도태 (§4.7 · V7 · V10) ──────────────────────────────────
  // 일보의 폐사·도태 칸은 원장의 합이다. 넣고 빼면 그 줄이 따라 바뀌어야 한다.
  console.log('\n━━ 폐사·도태 ━━');
  {
    const D = `/api/reports/${reportId}/deaths`;
    const row = { penId: rows[0].penId, categoryId: rows[0].categoryId };
    const list = await call('GET', D);
    ck('사유 6가지가 온다', list.body?.reasons?.length === 6, `실제 ${list.body?.reasons?.length}`);

    const noPhoto = await call('POST', D, { kind: 'mortality', ...row, headCount: 2, reasonCode: '03' });
    ck('사진도 사유도 없으면 폐사 등록 거부 (V10)', noPhoto.status === 422, `실제 ${noPhoto.status}`);

    const waived = await call('POST', D, { kind: 'mortality', ...row, headCount: 2, reasonCode: '03',
      photoWaiver: '휴대폰 배터리 없음' });
    ck('사진 없음 사유로 등록', waived.status === 201, JSON.stringify(waived.body)?.slice(0, 90));
    ck('그 줄 폐사가 2 가 된다 (V7)', waived.body?.row?.deadHead === 2, JSON.stringify(waived.body?.row));
    ck('24시간 보완 기한이 붙는다', !!waived.body?.item?.photoDueAt);

    const g = await call('GET', `/api/reports/${jadon}/${TEST_DATE}`);
    ck('일보 당일두수가 폐사만큼 준다', g.body.rows[0].closingHead === prev + 10 - 2,
      `실제 ${g.body.rows[0].closingHead}`);

    const other6 = await call('POST', D, { kind: 'culling', ...row, headCount: 1, reasonCode: '06' });
    ck('「기타」는 사유를 적어야 한다', other6.status === 422, `실제 ${other6.status}`);
    const wrongScope = await call('POST', D, { kind: 'culling', ...row, headCount: 1, reasonCode: '03' });
    ck('압사는 도태 사유가 아니다', wrongScope.status === 422, `실제 ${wrongScope.status}`);
    const cull = await call('POST', D, { kind: 'culling', ...row, headCount: 1, reasonCode: '05' });
    ck('도태 등록', cull.status === 201 && cull.body?.row?.culledHead === 1, JSON.stringify(cull.body?.row));

    // 사진 — 그림 파일을 그대로 올리고 받은 키로 등록한다
    const img = Buffer.from('ffd8ffe000104a464946000101', 'hex');
    const up = await fetch(base + D + '/photo', {
      method: 'POST', headers: { 'content-type': 'image/jpeg', cookie }, body: img });
    const upBody = await up.json().catch(() => null);
    ck('사진 올리기', up.status === 201 && !!upBody?.photoKey, `실제 ${up.status} ${JSON.stringify(upBody)}`);
    const withPhoto = await call('POST', D, { kind: 'mortality', ...row, headCount: 1, reasonCode: '01',
      photoKey: upBody?.photoKey });
    ck('사진과 함께 폐사 등록', withPhoto.status === 201 && withPhoto.body?.item?.hasPhoto === true,
      JSON.stringify(withPhoto.body)?.slice(0, 90));
    const seen = await fetch(`${base}${D}/mortality/${withPhoto.body?.item?.id}/photo`, { headers: { cookie } });
    const seenBuf = Buffer.from(await seen.arrayBuffer());
    ck('올린 사진을 그대로 돌려준다', seen.status === 200 && seenBuf.equals(img), `실제 ${seen.status}`);

    const log = await call('GET', `/api/deaths?date=${TEST_DATE}`);
    ck('폐사·도태 일지에 그 날 기록이 모인다', log.status === 200 && log.body?.items?.length === 3,
      `실제 ${log.status} ${log.body?.items?.length}`);
    ck('일지는 사진 보완 대기를 알려 준다',
      log.body?.items?.filter((x) => x.kind === 'mortality' && !x.hasPhoto).length === 1);
    const logOther = await call('GET', `/api/deaths?date=${TEST_DATE}&houseId=${bunman}`);
    ck('담당 아닌 돈사 일지는 403', logOther.status === 403, `실제 ${logOther.status}`);

    const del = await call('DELETE', `${D}/mortality/${waived.body?.item?.id}`);
    ck('빼면 그 줄 폐사가 준다', del.status === 200 && del.body?.row?.deadHead === 1, JSON.stringify(del.body));

    const back = await call('PUT', `/api/reports/${reportId}/rows`, { rows });
    ck('폐사가 있어도 제출 가능 (원장과 일보가 맞다)', back.body?.canSubmit === true,
      JSON.stringify(back.body?.violations)?.slice(0, 120));
  }

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
  const lockedDeath = await call('POST', `/api/reports/${reportId}/deaths`,
    { kind: 'culling', penId: rows[0].penId, headCount: 1, reasonCode: '05' });
  ck('제출 후 폐사·도태 추가 거부', lockedDeath.status === 409, `실제 ${lockedDeath.status}`);

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

  // 제출 현황은 본사 화면이지만 팀장도 부를 수 있다. 그때 남의 돈사가 보이면 안 된다.
  {
    const save = cookie;
    cookie = '';
    await call('POST', '/api/auth/login', { loginId: 'smoke.lead', password: TEST_PW });
    const mine = await call('GET', `/api/reports/status?date=${TEST_DATE}`);
    ck('팀장의 제출 현황은 담당 돈사만', mine.body?.houses?.length === 1
      && mine.body.houses[0].code === 'JADON',
      `실제 ${mine.body?.houses?.length}개 ${JSON.stringify(mine.body?.houses?.map((h) => h.code))}`);
    cookie = save;
  }

  ck('자돈사가 확정으로 보인다',
    status.body?.houses?.find((h) => h.code === 'JADON')?.status === 'confirmed');

  // ── 로그아웃 ──────────────────────────────────────────────────────
  // ── 계정 관리 ─────────────────────────────────────────────────────
  // 현장이 스스로 관리해야 하므로 넓게 열려 있다. 열린 만큼 경계가 중요하다.
  console.log('\n━━ 계정 관리 ━━');

  // 지금은 본사(smoke.hq)로 붙어 있다.
  const ov = await call('GET', '/api/admin/overview');
  ck('본사는 관리 화면을 본다', ov.status === 200, `실제 ${ov.status}`);
  ck('돈사별 담당 현황이 온다', ov.body?.owners?.length === 12, `실제 ${ov.body?.owners?.length}`);
  ck('본사는 등급을 바꿀 수 있다', ov.body?.can?.roles === true);

  // 담당 배정 — 이게 매일 쓰이는 기능이다
  const mk = await call('POST', '/api/admin/scopes', { userId: lead, houseId: bunman });
  ck('담당 배정', mk.status === 201, JSON.stringify(mk.body)?.slice(0, 80));

  // 배정한 것이 실제로 권한이 되는지 — 여기까지 와야 「됐다」고 할 수 있다
  {
    const save = cookie;
    cookie = '';
    await call('POST', '/api/auth/login', { loginId: 'smoke.lead', password: TEST_PW });
    const me2 = await call('GET', '/api/auth/me');
    const reach = await call('GET', `/api/reports/${bunman}/${TEST_DATE}`);
    ck('배정하면 바로 그 돈사가 보인다', me2.body?.scopes?.length === 2,
      `실제 ${me2.body?.scopes?.length}`);
    ck('아까 403 이던 돈사가 열린다', reach.status === 200, `실제 ${reach.status}`);
    cookie = save;
  }

  const dup = await call('POST', '/api/admin/scopes', { userId: lead, houseId: bunman });
  ck('같은 담당을 두 번 넣으면 409', dup.status === 409, `실제 ${dup.status}`);

  const backdate = await call('POST', '/api/admin/scopes/end',
    { userId: lead, houseId: bunman, from: '2020-01-01' });
  ck('시작보다 앞선 날짜로는 못 끝낸다', backdate.status === 422, `실제 ${backdate.status}`);

  const off = await call('POST', '/api/admin/scopes/end',
    { userId: lead, houseId: bunman, from: '2031-06-01' });
  ck('담당 해제 (미래 날짜 예약)', off.status === 200, JSON.stringify(off.body)?.slice(0, 80));

  // 지우지 않고 닫는다 — 이력이 남아야 「그때 누가 담당이었나」를 안다
  const hist = (await admin.query(
    `select valid_to::text as t from sec.user_scope
      where user_id=$1 and house_id=$2`, [lead, bunman])).rows[0];
  ck('해제해도 줄이 남는다 (이력)', hist?.t === '2031-05-31', `실제 ${hist?.t}`);

  // 잘못 누른 칸을 바로 다시 누르는 경우 — 오늘 넣고 오늘 뺀다.
  // 끝낼 날(어제)이 시작(오늘)보다 앞서 기간을 닫을 수 없으니 지정을 취소한다
  {
    const other = (await admin.query(
      `select id from app.house where code not in ('JADON','BUNMAN1') order by seq limit 1`)).rows[0].id;
    await call('POST', '/api/admin/scopes', { userId: lead, houseId: other });
    const undo = await call('POST', '/api/admin/scopes/end', { userId: lead, houseId: other });
    ck('오늘 넣은 담당을 오늘 빼면 취소된다', undo.status === 200, JSON.stringify(undo.body)?.slice(0, 80));
    const left = (await admin.query(
      `select count(*)::int n from sec.user_scope where user_id=$1 and house_id=$2`, [lead, other])).rows[0].n;
    ck('취소하면 그 줄은 남지 않는다', left === 0, `실제 ${left}`);
  }

  // 계정 만들기
  const made = await call('POST', '/api/admin/users',
    { loginId: 'smoke.new', name: '새 팀장', roles: ['team_lead'] });
  ck('계정 생성', made.status === 201, JSON.stringify(made.body)?.slice(0, 80));
  ck('임시 비밀번호를 한 번 돌려준다',
    typeof made.body?.password === 'string' && made.body.password.length >= 12);

  {
    const save = cookie;
    cookie = '';
    const r = await call('POST', '/api/auth/login',
      { loginId: 'smoke.new', password: made.body.password });
    ck('그 비밀번호로 로그인된다', r.status === 200, `실제 ${r.status}`);
    cookie = save;
  }

  const relock = await call('PATCH', `/api/admin/users/${made.body.userId}`,
    { status: 'suspended' });
  ck('계정 중지', relock.status === 200, `실제 ${relock.status}`);

  {
    const save = cookie;
    cookie = '';
    const r = await call('POST', '/api/auth/login',
      { loginId: 'smoke.new', password: made.body.password });
    ck('중지하면 로그인 거부', r.status === 401, `실제 ${r.status}`);
    cookie = save;
  }

  const selfLock = await call('PATCH', `/api/admin/users/${hq}`, { status: 'suspended' });
  ck('자기 계정은 스스로 중지 못 한다', selfLock.status === 422, `실제 ${selfLock.status}`);

  const changed = await call('POST', `/api/admin/users/${made.body.userId}/roles`,
    { roles: ['team_lead', 'admin'] });
  ck('본사는 관리자 권한을 줄 수 있다', changed.status === 200,
    JSON.stringify(changed.body)?.slice(0, 80));

  const log = await call('GET', '/api/admin/audit?limit=20');
  ck('바꾼 것이 이력에 남는다',
    log.body?.entries?.some((e) => /담당 지정|계정 생성|등급/.test(e.detail ?? '')),
    JSON.stringify(log.body?.entries?.slice(0, 2)));

  // ── 경계 : 팀장은 어디까지 ────────────────────────────────────────
  console.log('\n━━ 계정 관리 경계 ━━');
  cookie = '';
  await call('POST', '/api/auth/login', { loginId: 'smoke.lead', password: TEST_PW });

  const noAdmin = await call('GET', '/api/admin/overview');
  ck('관리자 권한 없는 팀장은 403', noAdmin.status === 403, `실제 ${noAdmin.status}`);

  // 관리자 권한을 주면 담당은 바꿀 수 있다
  await admin.query(`insert into sec.user_role (user_id,role) values ($1,'admin')`, [lead]);
  cookie = '';
  await call('POST', '/api/auth/login', { loginId: 'smoke.lead', password: TEST_PW });

  const asAdmin = await call('GET', '/api/admin/overview');
  ck('관리자 권한을 받은 팀장은 들어간다', asAdmin.status === 200, `실제 ${asAdmin.status}`);
  ck('단 등급 변경 단추는 없다', asAdmin.body?.can?.roles === false);

  const scopeOk = await call('POST', '/api/admin/scopes', { userId: lead, houseId: bunman });
  ck('담당은 스스로 바꿀 수 있다', scopeOk.status === 201, `실제 ${scopeOk.status}`);

  // SoD-1 — 여기가 무너지면 팀장이 자기 일보를 자기가 확정한다
  const escalate = await call('POST', `/api/admin/users/${lead}/roles`,
    { roles: ['team_lead', 'admin', 'hq_staff'] });
  ck('팀장은 스스로 본사 등급을 못 가진다 (SoD-1)', escalate.status === 403,
    `실제 ${escalate.status}`);

  const makeHq = await call('POST', '/api/admin/users',
    { loginId: 'smoke.bad', name: '우회 시도', roles: ['hq_staff'] });
  ck('본사 등급 계정도 못 만든다', makeHq.status === 403, `실제 ${makeHq.status}`);

  // 계정 관리 연결로는 일보가 안 보인다 (SoD-3). DB 계층에서 이미 막혀 있으나
  // 라우터가 실수로 업무 질의를 섞었는지 여기서도 한 번 본다.
  const leak = await call('GET', '/api/admin/overview');
  ck('관리 화면 응답에 업무 데이터가 섞여 있지 않다',
    !/closing_head|openingHead|pen_daily/.test(JSON.stringify(leak.body)));

  console.log('\n━━ 로그아웃 ━━');
  await call('POST', '/api/auth/logout');
  ck('로그아웃 후 401', (await call('GET', '/api/auth/me')).status === 401);

} finally {
  await clearTestData();
  await admin.query(`delete from sec.app_user where login_id in ('smoke.lead','smoke.hq','smoke.new','smoke.bad')`);
  // 감사로그는 지우지 않는다 — 지울 수 없다. append-only 규칙이 DELETE 를
  // 무동작으로 만든다. 시험이 남긴 줄도 그대로 남는 것이 맞다 (§6.6).
  await admin.end();
  server.close();
  await pool.end();
}

console.log(`\n━━ 결과 ━━\n  통과 ${pass} · 실패 ${fail}`);
if (fail) { console.log('\n실패:'); fails.forEach((f) => console.log('  · ' + f)); }
process.exit(fail ? 1 : 0);
