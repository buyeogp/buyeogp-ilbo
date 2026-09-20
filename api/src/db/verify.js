/**
 * 스키마 실행 검증 — 올라간 것이 실제로 동작하는지 본다.
 *
 * 정적 점검(db/tools/check_sql.py)은 문법과 참조만 본다. 트리거가 정말 막는지,
 * 생성열이 정말 계산하는지는 DB 에 올려서 시켜봐야 안다. 이 파일이 그 역할이다.
 *
 * 모든 동작 시험은 트랜잭션 안에서 하고 끝나면 롤백한다. 데이터가 남지 않는다.
 *
 * 사용: node src/db/verify.js
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const env = {};
for (const l of readFileSync(path.join(ROOT, 'infra', '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const client = new pg.Client({
  host: env.DB_HOST,
  port: Number(env.DB_PORT || 5432),
  user: env.DB_MIGRATE_USER,
  password: env.DB_MIGRATE_PASSWORD,
  database: env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
  application_name: 'buyeogp-verify',
});

let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`);
         console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`); }
}

/** 실패해야 정상인 문장. 지정한 문구가 오류에 들어 있어야 통과 */
async function mustFail(name, sql, expect) {
  await client.query('SAVEPOINT sp');
  try {
    await client.query(sql);
    await client.query('ROLLBACK TO sp');
    check(name, false, '거부되지 않고 통과했다');
  } catch (e) {
    await client.query('ROLLBACK TO sp');
    const hit = !expect || (e.message || '').includes(expect);
    check(name, hit, hit ? '' : `다른 이유로 실패: ${e.message.slice(0, 70)}`);
  }
}

async function mustPass(name, sql) {
  await client.query('SAVEPOINT sp');
  try {
    const r = await client.query(sql);
    await client.query('RELEASE SAVEPOINT sp');
    return r;
  } catch (e) {
    await client.query('ROLLBACK TO sp');
    check(name, false, e.message.slice(0, 90));
    return null;
  }
}

await client.connect();

// ─────────────────────────────────────────────────────────────────────
console.log('\n━━ 1. 객체 수 ━━');
const inv = (await client.query(`
  select
   (select count(*) from pg_tables where schemaname in ('app','sec')
      and tablename not like 'm3\_%')                                        as tables,
   (select count(*) from pg_tables where schemaname='app'
      and tablename like 'm3\_%')                                            as m3_temp,
   (select count(*) from pg_views  where schemaname = 'app')                 as views,
   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='app')                                                  as funcs,
   (select count(*) from pg_policies where schemaname in ('app','sec'))      as policies,
   (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
     join pg_namespace n on n.oid=c.relnamespace
     where n.nspname in ('app','sec') and not t.tgisinternal)                as triggers,
   (select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid
     join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='app' and a.attgenerated='s')                           as generated,
   (select count(*) from pg_constraint co join pg_namespace n on n.oid=co.connamespace
     where n.nspname='app' and co.contype='c')                               as checks`)).rows[0];
console.table(inv);
check('스키마 테이블 57개 (m3_* 제외)', +inv.tables === 57, `실제 ${inv.tables}`);
check('트리거 56개 이상', +inv.triggers >= 56, `실제 ${inv.triggers}`);
check('뷰 16개', +inv.views === 16, `실제 ${inv.views}`);
check('생성열 9개 이상', +inv.generated >= 9, `실제 ${inv.generated}`);

// ─────────────────────────────────────────────────────────────────────
console.log('\n━━ 2. RLS 적용 범위 ━━');
const rls = (await client.query(`
  select c.relname as t, c.relrowsecurity as on_,
         (select count(*) from pg_policies p
           where p.schemaname='app' and p.tablename=c.relname) as pol
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='app' and c.relkind='r' order by 1`)).rows;
const noRls = rls.filter((r) => !r.on_);
const rlsNoPol = rls.filter((r) => r.on_ && +r.pol === 0);
console.log(`  RLS 켜짐 ${rls.length - noRls.length} / 전체 ${rls.length}`);
check('RLS 켜진 테이블에 정책이 하나도 없는 경우 없음', rlsNoPol.length === 0,
      rlsNoPol.map((r) => r.t).join(', '));
console.log(`  RLS 꺼진 테이블: ${noRls.map((r) => r.t).join(', ') || '없음'}`);

// ─────────────────────────────────────────────────────────────────────
console.log('\n━━ 3. 마스터 시드 ━━');
const seed = (await client.query(`
  select (select count(*) from app.pen)                                as pens,
         (select count(*) from app.house_category)                     as cats,
         (select count(*) from app.medicine)                           as meds,
         (select count(*) from app.feed)                               as feeds,
         (select count(*) from app.feed_price_history)                 as prices,
         (select count(*) from app.vaccine_schedule)                   as vacc,
         (select count(*) from app.movement_schedule)                  as sched`)).rows[0];
console.table(seed);
check('돈방 133', +seed.pens === 133, `실제 ${seed.pens}`);
check('집계행 25', +seed.cats === 25, `실제 ${seed.cats}`);
check('사료 단가이력 119', +seed.prices === 119, `실제 ${seed.prices}`);

const byHouse = (await client.query(`
  select h.name, count(p.id)::int n from app.house h
   left join app.pen p on p.house_id=h.id group by h.name,h.seq order by h.seq`)).rows;
const want = { '분만1동': 11, '분만2동': 11, '자돈사': 28, '육성사': 15,
               '검정사': 40, '비육사(수)': 28 };
for (const [k, v] of Object.entries(want)) {
  const got = byHouse.find((r) => r.name === k)?.n ?? 0;
  check(`${k} ${v}방`, got === v, `실제 ${got}`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n━━ 4. 동작 시험 (전부 롤백된다) ━━');
await client.query('BEGIN');

// 계정만 migration 모드로 만든다. 이후 시험은 운영과 같은 조건에서 한다.
await client.query(`select set_config('app.migration','on',true)`);
const uid = (await client.query(`
  insert into sec.app_user (login_id,name,password_hash,status)
  values ('verify.a','검증 작성자','!','active') returning id`)).rows[0].id;
const uid2 = (await client.query(`
  insert into sec.app_user (login_id,name,password_hash,status)
  values ('verify.b','검증 확정자','!','active') returning id`)).rows[0].id;
await client.query(`select set_config('app.user_id',$1,true)`, [uid]);
await client.query(`select set_config('app.migration','off',true)`);

const ctx = (await client.query(`
  select h.id house, h.farm_id farm, p.id pen
    from app.house h join app.pen p on p.house_id=h.id
   where h.code='JADON' order by p.seq limit 1`)).rows[0];

// is_baseline 이면 전일두수 자동 이월(V2)을 건너뛴다 — 첫날이라 이월할 것이 없다
const rep = (await client.query(`
  insert into app.daily_report (farm_id,house_id,report_date,status,author_id,is_baseline)
  values ($1,$2,date '2030-01-01','draft',$3,true) returning id`,
  [ctx.farm, ctx.house, uid])).rows[0].id;

// ── 생성열 ──────────────────────────────────────────────────────────
const v1 = await mustPass('V1 생성열', `
  insert into app.pen_daily (report_id,farm_id,house_id,report_date,pen_id,
    opening_head,in_head,out_head,internal_out_head,sold_head,dead_head)
  values (${rep},${ctx.farm},${ctx.house},date '2030-01-01',${ctx.pen},100,20,5,3,2,1)
  returning closing_head`);
if (v1) check('V1 당일두수 = 100+20-5-3-2-1 = 109', v1.rows[0].closing_head === 109,
              `실제 ${v1.rows[0].closing_head}`);

await mustFail('V3 재고 초과 출고 거부',
  `insert into app.pen_daily (report_id,farm_id,house_id,report_date,pen_id,batch_id,
     opening_head,out_head)
   values (${rep},${ctx.farm},${ctx.house},date '2030-01-01',${ctx.pen},null,10,999)`,
  'v3_no_negative_stock');

await mustFail('V4 같은 돈방 중복 거부',
  `insert into app.pen_daily (report_id,farm_id,house_id,report_date,pen_id,opening_head)
   values (${rep},${ctx.farm},${ctx.house},date '2030-01-01',${ctx.pen},50)`,
  'v4_no_duplicate');

await mustFail('SoD-1 입력자 = 확정자 거부',
  `update app.daily_report set confirmed_by=${uid} where id=${rep}`,
  'sod1_author_ne_confirmer');

// ── 번식 생성열 ─────────────────────────────────────────────────────
const sow = (await client.query(`
  insert into app.sow (farm_id,ear_tag,source) values ($1,'V-9999','manual') returning id`,
  [ctx.farm])).rows[0].id;

// DATE 는 텍스트로 받는다. Date 객체로 받으면 toISOString() 이 KST→UTC 로
// 하루 당겨 읽혀 멀쩡한 값이 틀린 것처럼 보인다.
const br = await mustPass('V6-3 분만예정일', `
  insert into app.breeding (farm_id,mating_date,sow_id,sow_ear_tag)
  values (${ctx.farm}, date '2030-03-01', ${sow}, 'V-9999')
  returning expected_farrow_date::text as d`);
if (br) check('V6-3 = 종부일 + 114일 (2030-06-23)',
  br.rows[0].d === '2030-06-23', `실제 ${br.rows[0].d}`);

const fa = await mustPass('V6 실산 생성열', `
  insert into app.farrowing (farm_id,farrow_date,sow_id,sow_ear_tag,
    total_born,stillborn,crushed,mummified,small,live_born_reported)
  values (${ctx.farm}, date '2030-06-23', ${sow}, 'V-9999', 15,2,1,1,1, 8)
  returning live_born, live_born_variance`);
if (fa) {
  check('V6 실산 = 15-(2+1+1+1) = 10', fa.rows[0].live_born === 10, `실제 ${fa.rows[0].live_born}`);
  check('V6 대장 기재값과의 차이 −2 검출', fa.rows[0].live_born_variance === -2,
        `실제 ${fa.rows[0].live_born_variance}`);
}

// ── V9 휴약기간 ─────────────────────────────────────────────────────
const med = (await client.query(
  `select id, name, withdrawal_days from app.medicine where withdrawal_days >= 30 limit 1`)).rows[0];
if (med) {
  const mu = (await client.query(`
    insert into app.medicine_usage (farm_id,event_date,house_id,pen_id,medicine_id,qty,
      withdrawal_days_applied,created_by)
    values ($1, date '2030-01-01', $2, $3, $4, 1, 0, $5)
    returning withdrawal_days_applied, withdrawal_until::text as until`,
    [ctx.farm, ctx.house, ctx.pen, med.id, uid])).rows[0];
  check(`V9 휴약일수 ${med.withdrawal_days}일 자동 기입`,
        mu.withdrawal_days_applied === med.withdrawal_days,
        `실제 ${mu.withdrawal_days_applied}`);
  check('V9 휴약 종료일 = 투여일 + 휴약일수', mu.until === '2030-02-05', `실제 ${mu.until}`);
  await mustFail(`V9 휴약 중 출하 거부 (${med.name})`,
    `insert into app.shipment (farm_id,ship_date,channel,pen_id,head_count,created_by)
     values (${ctx.farm}, date '2030-01-10','자돈출하',${ctx.pen},10,${uid})`,
    '휴약기간 미경과');
  await mustPass('V9 휴약 경과 후 출하 허용', `
    insert into app.shipment (farm_id,ship_date,channel,pen_id,head_count,created_by)
    values (${ctx.farm}, date '2030-02-06','자돈출하',${ctx.pen},10,${uid})`);
}

// ── V7 폐사는 원장에서 파생 ─────────────────────────────────────────
const rc = (await client.query(`select id from app.reason_code where code='01'`)).rows[0].id;
await client.query(`
  insert into app.mortality (farm_id,event_date,house_id,pen_id,head_count,
    reason_code_id,photo_url,created_by)
  values ($1, date '2030-01-01', $2, $3, 4, $4, 'x://p.jpg', $5)`,
  [ctx.farm, ctx.house, ctx.pen, rc, uid]);
const dead = (await client.query(
  `select dead_head, closing_head from app.pen_daily where report_id=${rep}`)).rows[0];
check('V7 폐사 4두가 일보에 자동 반영', dead.dead_head === 4, `실제 ${dead.dead_head}`);
check('V7 반영 후 당일두수 재계산 109→106', dead.closing_head === 106,
      `실제 ${dead.closing_head}`);

await mustFail('V7 일보에서 폐사 두수 직접 수정 거부',
  `update app.pen_daily set dead_head=99 where report_id=${rep}`,
  '폐사·도태 두수는');

await mustFail('V10 사진·사유 없는 폐사 거부',
  `insert into app.mortality (farm_id,event_date,house_id,pen_id,head_count,
     reason_code_id,created_by)
   values (${ctx.farm}, date '2030-01-01', ${ctx.house}, ${ctx.pen}, 1, ${rc}, ${uid})`,
  'v10_photo_required');

// ── V8 이동 대사 ────────────────────────────────────────────────────
const mv = (await client.query(`
  insert into app.movement (farm_id,event_date,from_pen_id,total_head,move_type,created_by)
  values ($1, date '2030-01-01', $2, 100, '돈사간전출', $3) returning id, status`,
  [ctx.farm, ctx.pen, uid])).rows[0];
check('V8 수령 전 상태 pending', mv.status === 'pending', `실제 ${mv.status}`);
await mustFail('V8 발신 초과 수령 거부',
  `insert into app.movement_line (movement_id,farm_id,head_count) values (${mv.id},${ctx.farm},101)`,
  '초과');
await client.query(
  `insert into app.movement_line (movement_id,farm_id,head_count) values ($1,$2,60)`,
  [mv.id, ctx.farm]);
check('V8 일부만 수령하면 disputed',
  (await client.query(`select status from app.movement where id=${mv.id}`)).rows[0].status
    === 'disputed');
await client.query(
  `insert into app.movement_line (movement_id,farm_id,to_pen_id,head_count)
   values ($1,$2,$3,40)`, [mv.id, ctx.farm, ctx.pen]);
check('V8 합계 일치 시 matched',
  (await client.query(`select status from app.movement where id=${mv.id}`)).rows[0].status
    === 'matched');

// ── L1 미입력 행 검출 · 상태 전이 ───────────────────────────────────
const before = (await client.query(
  `select count(*)::int n from app.fn_validate_report(${rep}) where severity='block'`)).rows[0].n;
check('L1 미입력 돈방 27개 검출', before === 27, `실제 ${before}`);
await mustFail('L1 미입력 상태에서 제출 거부',
  `update app.daily_report set status='submitted', submitted_at=now() where id=${rep}`,
  '검증 위반');

// 나머지 27개 돈방을 0 으로 채운다 — 현장이 「변동 없음」을 명시하는 것과 같다
await client.query(`
  insert into app.pen_daily (report_id,farm_id,house_id,report_date,pen_id,opening_head)
  select $1,$2,$3,date '2030-01-01',p.id,0
    from app.pen p where p.house_id=$3
     and p.id not in (select pen_id from app.pen_daily where report_id=$1)`,
  [rep, ctx.farm, ctx.house]);
const after = (await client.query(
  `select count(*)::int n from app.fn_validate_report(${rep}) where severity='block'`)).rows[0].n;
check('L1 전 돈방 입력 후 차단 사유 0', after === 0, `실제 ${after}`);

await mustFail('상태 전이 draft → confirmed 건너뛰기 거부',
  `update app.daily_report set status='confirmed', confirmed_at=now() where id=${rep}`,
  '허용되지 않는 상태 전이');

await client.query(
  `update app.daily_report set status='submitted', submitted_at=now() where id=${rep}`);
check('제출 성공 (draft → submitted)', true);
await client.query(`select set_config('app.user_id',$1,true)`, [uid2]);
await client.query(
  `update app.daily_report set status='confirmed' where id=${rep}`);
const conf = (await client.query(
  `select status, confirmed_by from app.daily_report where id=${rep}`)).rows[0];
check('확정 시 확정자·시각 자동 기입', conf.status === 'confirmed' && conf.confirmed_by === uid2);

// ── V5 / V2 전일 연결 ───────────────────────────────────────────────
await client.query(`select set_config('app.user_id',$1,true)`, [uid]);
const rep2 = (await client.query(`
  insert into app.daily_report (farm_id,house_id,report_date,status,author_id)
  values ($1,$2,date '2030-01-02','draft',$3) returning id`,
  [ctx.farm, ctx.house, uid])).rows[0].id;
check('V5 전일 확정 후 익일 일보 생성 허용', true);

const carried = (await client.query(`
  insert into app.pen_daily (report_id,pen_id,opening_head,farm_id,house_id,report_date)
  values ($1,$2,0,$3,$4,date '2030-01-02') returning opening_head`,
  [rep2, ctx.pen, ctx.farm, ctx.house])).rows[0];
check('V2 전일 당일두수 106 자동 이월', carried.opening_head === 106,
      `실제 ${carried.opening_head}`);
await mustFail('V2 전일두수 수정 거부',
  `update app.pen_daily set opening_head=1 where report_id=${rep2}`, 'V2');
await mustFail('P4 확정된 일보 직접 수정 거부',
  `update app.pen_daily set in_head=7 where report_id=${rep}`, 'P4');

// ── V5 를 다시 확인 (3일차는 2일차가 미확정) ────────────────────────
await mustFail('V5 전일 미확정 시 익일 일보 거부',
  `insert into app.daily_report (farm_id,house_id,report_date,status,author_id)
   values (${ctx.farm},${ctx.house},date '2030-01-03','draft',${uid})`,
  'V5');

await client.query('ROLLBACK');

// ─────────────────────────────────────────────────────────────────────
console.log('\n━━ 결과 ━━');
console.log(`  통과 ${pass} · 실패 ${fail}`);
if (fail) {
  console.log('\n실패 항목:');
  failures.forEach((f) => console.log(`  · ${f}`));
}
const left = (await client.query(
  `select count(*)::int n from app.pen_daily`)).rows[0].n;
console.log(`\n롤백 확인 — pen_daily ${left.toLocaleString()}행 (시험 전과 같아야 한다)`);
const stray = (await client.query(
  `select count(*)::int n from sec.app_user where login_id like 'verify.%'`)).rows[0].n;
check('시험 계정이 남지 않음', stray === 0, `${stray}건 남았다`);

await client.end();
process.exit(fail ? 1 : 0);
