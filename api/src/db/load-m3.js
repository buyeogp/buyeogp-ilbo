/**
 * M3 과거 데이터 적재 — 설계문서 §9
 *
 * psql 의 \copy 를 쓸 수 없어 CSV 를 직접 읽어 넣는다. 하는 일은 같다.
 *   1. m3_00_staging.sql   스테이징 테이블
 *   2. m3_pen_daily.csv    3,682행 (현행 일보 5종 판독본)
 *   3. m3_01_load.sql      daily_report · pen_daily 로 전개
 *   4. m3_feed_delivery.csv 674행 (사료 투입, 2025-12 ~ 2026-08)
 *   5. 엑셀 기재값과 시스템 계산값 대조
 *
 * 사용: node src/db/load-m3.js [--reset]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MIG = path.join(ROOT, 'db', 'migration');

const env = {};
for (const l of (await readFile(path.join(ROOT, 'infra', '.env'), 'utf8')).split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const client = new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
  user: env.DB_MIGRATE_USER, password: env.DB_MIGRATE_PASSWORD,
  database: env.DB_NAME || 'postgres',
  ssl: { rejectUnauthorized: false },
  application_name: 'buyeogp-load-m3',
  statement_timeout: 0, query_timeout: 0,
});

const stripMeta = (sql) => sql
  .split(/\r?\n/)
  .map((l) => (/^\s*\\(ir|echo|set|i|copy)\b/i.test(l) ? '' : l))
  .join('\n')
  .replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');   // 바깥 트랜잭션이 이미 있다

function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.filter(Boolean).map((l) => {
    const v = l.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
  });
}

/** 여러 행을 한 문장으로 넣는다. 3,682행을 한 줄씩 보내면 왕복이 너무 많다. */
async function bulkInsert(table, cols, rows, size = 400) {
  let done = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const params = [];
    const values = chunk.map((r, ri) =>
      '(' + cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(',') + ')').join(',');
    for (const r of chunk) for (const c of cols) params.push(r[c] === '' ? null : r[c]);
    await client.query(
      `insert into ${table} (${cols.join(',')}) values ${values}`, params);
    done += chunk.length;
  }
  return done;
}

await client.connect();
console.log(`접속  ${env.DB_MIGRATE_USER}@${env.DB_HOST}\n`);

const t0 = Date.now();
try {
  await client.query('BEGIN');

  if (process.argv.includes('--reset')) {
    await client.query('DROP TABLE IF EXISTS app.m3_daily_raw');
    await client.query(`delete from app.pen_daily where report_date <= date '2026-09-30'`);
    await client.query(`delete from app.daily_report where report_date <= date '2026-09-30'`);
    await client.query(`delete from app.feed_delivery where event_date <= date '2026-09-30'`);
    console.log('  · 기존 적재분을 지웠습니다\n');
  }

  // 1 ─ 스테이징 테이블
  await client.query(stripMeta(await readFile(path.join(MIG, 'm3_00_staging.sql'), 'utf8')));
  console.log('  ✓ 스테이징 테이블 생성');

  // 2 ─ CSV → 스테이징
  const raw = parseCsv(await readFile(path.join(MIG, 'm3_pen_daily.csv'), 'utf8'));
  const cols = ['house_code', 'pen_code', 'category_code', 'report_date',
    'opening_head', 'in_head', 'out_head', 'internal_out_head', 'sold_head', 'dead_head',
    'excel_closing', 'owner_transfer_head', 'weaned_out_head',
    'recurred_head', 'aborted_head', 'infertile_head',
    'entry_date', 'birth_date_avg', 'entry_weight', 'sex_mix', 'note'];
  // 문자열 칸은 NOT NULL DEFAULT '' 이므로 빈 값을 NULL 로 보내면 안 된다
  for (const r of raw) {
    for (const c of ['pen_code', 'category_code', 'entry_date', 'birth_date_avg',
                     'entry_weight', 'sex_mix', 'note']) {
      if (r[c] === '') r[c] = ' ';
    }
  }
  const n = await bulkInsert('app.m3_daily_raw', cols, raw);
  await client.query(`update app.m3_daily_raw set
      pen_code = trim(pen_code), category_code = trim(category_code),
      entry_date = trim(entry_date), birth_date_avg = trim(birth_date_avg),
      entry_weight = trim(entry_weight), sex_mix = trim(sex_mix), note = trim(note)`);
  console.log(`  ✓ 스테이징 ${n.toLocaleString()}행`);

  // 3 ─ 일보 · 두수 행으로 전개
  await client.query(stripMeta(
    (await readFile(path.join(MIG, 'm3_01_load.sql'), 'utf8'))
      .split('-- ── 적재 검증')[0]));
  console.log('  ✓ daily_report · pen_daily 전개');

  // 4 ─ 사료 투입
  const feed = parseCsv(await readFile(path.join(MIG, 'm3_feed_delivery.csv'), 'utf8'));
  await client.query(`create temp table t_feed
    (house_code text, feed_name text, event_date date, qty_kg numeric) on commit drop`);
  await bulkInsert('t_feed', ['house_code', 'feed_name', 'event_date', 'qty_kg'], feed);
  const fd = await client.query(`
    insert into app.feed_delivery (farm_id, event_date, house_id, feed_id, qty_kg, unit_price)
    select h.farm_id, t.event_date, h.id, f.id, sum(t.qty_kg),
           (select ph.unit_price from app.feed_price_history ph
             where ph.feed_id = f.id and ph.valid_from <= t.event_date
             order by ph.valid_from desc limit 1)
      from t_feed t
      join app.house h on h.code = t.house_code
      join app.feed  f on f.name = t.feed_name
     group by h.farm_id, t.event_date, h.id, f.id
    on conflict do nothing`);
  console.log(`  ✓ 사료 투입 ${fd.rowCount.toLocaleString()}행`);

  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`\n적재 실패 — 롤백했습니다.\n  ${e.message}`);
  if (e.detail) console.error(`  상세: ${e.detail}`);
  if (e.where) console.error(`  위치: ${e.where}`);
  await client.end();
  process.exit(1);
}

console.log(`\n완료 — ${((Date.now() - t0) / 1000).toFixed(1)}초\n`);

// 5 ─ 대조
const sum = (await client.query(`
  select count(distinct report_date)::int as 일자,
         count(distinct house_id)::int    as 돈사,
         count(*)::int                    as 행,
         min(report_date)::text           as 시작,
         max(report_date)::text           as 종료
    from app.pen_daily`)).rows[0];
console.table(sum);

const diff = (await client.query(`
  select h.name as 돈사, count(*)::int as 행,
         count(*) filter (where pd.closing_head = s.excel_closing)::int  as 일치,
         count(*) filter (where pd.closing_head <> s.excel_closing)::int as 불일치
    from app.m3_daily_raw s
    join app.house h on h.code = s.house_code
    join app.pen_daily pd
      on pd.house_id = h.id and pd.report_date = s.report_date
     and pd.pen_id is not distinct from
         (select p.id from app.pen p where p.house_id = h.id and p.code = s.pen_code)
     and pd.category_id is not distinct from
         (select c.id from app.pig_category c where c.code = s.category_code)
   where s.excel_closing is not null
   group by h.name, h.seq order by h.seq`)).rows;
console.log('── 엑셀 기재값 vs 시스템 계산값 ──');
console.table(diff);
const bad = diff.reduce((a, r) => a + r.불일치, 0);
const tot = diff.reduce((a, r) => a + r.행, 0);
console.log(`합계 ${tot.toLocaleString()}행 · 불일치 ${bad}건 (${(100 - 100 * bad / tot).toFixed(2)}% 일치)`);

if (bad) {
  const rows = (await client.query(`
    select s.report_date::text as 일자, h.name as 돈사,
           coalesce(nullif(s.pen_code,''), c.name) as 위치,
           s.excel_closing as 엑셀, pd.closing_head as 시스템,
           s.excel_closing - pd.closing_head as 차이
      from app.m3_daily_raw s
      join app.house h on h.code = s.house_code
      left join app.pig_category c on c.code = s.category_code
      join app.pen_daily pd
        on pd.house_id = h.id and pd.report_date = s.report_date
       and pd.pen_id is not distinct from
           (select p.id from app.pen p where p.house_id = h.id and p.code = s.pen_code)
       and pd.category_id is not distinct from
           (select c2.id from app.pig_category c2 where c2.code = s.category_code)
     where s.excel_closing is not null and pd.closing_head <> s.excel_closing
     order by 1, 2`)).rows;
  console.log('\n── 불일치 전건 (현장 확인 대상) ──');
  console.table(rows);
}

await client.end();
