/**
 * 스키마 적용기 — psql 없이 Node 로 돌린다.
 *
 * 이 장비에 psql 도 Docker 도 없어서 만들었다. 하는 일은 psql 과 같다.
 *   · db/001 ~ 017 을 순서대로, **하나의 트랜잭션**으로 실행한다
 *   · 도중에 실패하면 통째로 롤백한다 (000_run_all.sql 과 같은 보장)
 *   · psql 전용 메타명령(\ir, \echo, \set)은 걸러낸다
 *   · 오류가 나면 파일명과 줄 번호, 그 줄의 내용을 찍는다
 *
 * 사용
 *   node src/db/migrate.js              스키마 전체 (001~017)
 *   node src/db/migrate.js --check      연결만 확인
 *   node src/db/migrate.js --reset      app·sec 스키마를 지우고 다시 만든다 (개발 전용)
 *   node src/db/migrate.js --files a.sql b.sql
 *   node src/db/migrate.js --dry        실행하지 않고 목록만
 *
 * 접속 정보는 infra/.env 에서 읽는다.
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DB_DIR = path.join(ROOT, 'db');
const ENV_FILE = path.join(ROOT, 'infra', '.env');

// ── infra/.env 읽기 ──────────────────────────────────────────────────
function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of require('node:fs').readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

// ESM 에서 require 쓰기
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const env = { ...loadEnv(), ...process.env };

function config() {
  const host = env.DB_MIGRATE_HOST || env.DB_HOST;
  const user = env.DB_MIGRATE_USER || 'postgres';
  const password = env.DB_MIGRATE_PASSWORD || env.DB_PASSWORD;
  if (!host) throw new Error('DB_HOST 가 없습니다. infra/.env 를 확인하십시오.');
  if (!password) throw new Error('DB_MIGRATE_PASSWORD 가 없습니다. infra/.env 를 확인하십시오.');
  return {
    host,
    port: Number(env.DB_PORT || 5432),
    user,
    password,
    database: env.DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false },   // Supabase 는 TLS 필수
    application_name: 'buyeogp-migrate',
    statement_timeout: 0,
    query_timeout: 0,
  };
}

/** psql 메타명령을 제거한다. 남기면 문법 오류가 난다. */
function stripMeta(sql) {
  return sql
    .split(/\r?\n/)
    .map((l) => (/^\s*\\(ir|echo|set|i|copy)\b/i.test(l) ? '' : l))
    .join('\n');
}

/** 오류 position(문자 오프셋) → 파일 내 줄 번호 */
function locate(sql, position) {
  if (!position) return null;
  const upto = sql.slice(0, Number(position) - 1);
  const line = upto.split('\n').length;
  const text = sql.split('\n')[line - 1] ?? '';
  return { line, text: text.trim() };
}

async function schemaFiles() {
  const all = await readdir(DB_DIR);
  return all
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.startsWith('000'))
    .sort();
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const cfg = config();

console.log(`접속  ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);

const files = flag('--files')
  ? args.slice(args.indexOf('--files') + 1)
  : await schemaFiles();

if (flag('--dry')) {
  console.log(`\n실행 예정 ${files.length}개:`);
  files.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. ${f}`));
  process.exit(0);
}

const client = new pg.Client(cfg);
const t0 = Date.now();

try {
  await client.connect();
} catch (e) {
  console.error(`\n접속 실패: ${e.message}`);
  if (/ENETUNREACH|EHOSTUNREACH/.test(e.message || e.code || '')) {
    console.error('  IPv6 로만 열린 주소일 수 있습니다. Supabase 의 Session pooler(IPv4)를 쓰십시오.');
  }
  if (/password authentication failed/i.test(e.message)) {
    console.error('  비밀번호를 확인하십시오. Pooler 는 사용자명이 postgres.⟨project-ref⟩ 형식입니다.');
  }
  process.exit(1);
}

const v = await client.query('select version(), current_user, current_database()');
console.log(`서버  ${v.rows[0].version.split(',')[0]}`);
console.log(`사용자 ${v.rows[0].current_user}\n`);

if (flag('--check')) {
  await client.end();
  console.log('연결 확인 완료.');
  process.exit(0);
}

// ── 리셋 (개발 전용) ─────────────────────────────────────────────────
// 트랜잭션 **밖에서** 한다. 안에서 하면 없는 역할에 DROP OWNED 를 걸었을 때
// 트랜잭션 전체가 abort 되어 뒤따르는 문장이 전부 무시된다.
if (flag('--reset')) {
  const has = (await client.query(
    `select to_regclass('app.pen_daily') is not null as t`)).rows[0].t;
  if (has) {
    const n = (await client.query('select count(*)::int n from app.pen_daily')).rows[0].n;
    if (n > 0 && !flag('--force')) {
      console.error(`\napp.pen_daily 에 ${n}행이 있습니다.`);
      console.error('정말 지우려면 --force 를 함께 주십시오.');
      await client.end();
      process.exit(1);
    }
  }
  // 스키마를 먼저 지운다. 그러면 역할이 들고 있던 GRANT 도 함께 사라져
  // DROP ROLE 이 대개 그냥 통과한다.
  await client.query('DROP SCHEMA IF EXISTS app CASCADE');
  await client.query('DROP SCHEMA IF EXISTS sec CASCADE');

  for (const r of ['buyeogp_app', 'buyeogp_admin', 'buyeogp_auditor']) {
    const exists = (await client.query(
      'select 1 from pg_roles where rolname=$1', [r])).rowCount > 0;
    if (!exists) continue;
    try {
      await client.query(`DROP ROLE ${r}`);
    } catch {
      // 남은 권한이 있으면 그 역할의 멤버가 되어야 정리할 수 있다.
      // Supabase 의 postgres 는 슈퍼유저가 아니라 이 단계가 필요하다.
      await client.query(`GRANT ${r} TO CURRENT_USER`);
      await client.query(`DROP OWNED BY ${r} CASCADE`);
      await client.query(`DROP ROLE ${r}`);
    }
  }
  console.log('  · app·sec 스키마와 역할 3종을 지웠습니다\n');
}

let ok = 0;
try {
  await client.query('BEGIN');

  for (const f of files) {
    const full = path.isAbsolute(f) ? f : path.join(DB_DIR, f);
    const raw = await readFile(full, 'utf8');
    const sql = stripMeta(raw);
    const s = Date.now();
    try {
      await client.query(sql);
    } catch (e) {
      const at = locate(sql, e.position);
      console.error(`\n✗ ${path.basename(f)}`);
      console.error(`  ${e.message}`);
      if (e.detail) console.error(`  상세: ${e.detail}`);
      if (e.hint) console.error(`  힌트: ${e.hint}`);
      if (at) console.error(`  위치: ${path.basename(f)}:${at.line}\n        ${at.text}`);
      throw e;
    }
    ok++;
    console.log(`  ✓ ${path.basename(f).padEnd(34)} ${String(Date.now() - s).padStart(5)} ms`);
  }
  await client.query('COMMIT');
  console.log(`\n완료 — ${ok}개 파일, ${((Date.now() - t0) / 1000).toFixed(1)}초`);

  const r = await client.query(`
    select
      (select count(*) from pg_tables      where schemaname in ('app','sec')) as 테이블,
      (select count(*) from pg_views       where schemaname = 'app')          as 뷰,
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='app')                                               as 함수,
      (select count(*) from pg_policies    where schemaname in ('app','sec')) as 정책,
      (select count(*) from app.pen)                                         as 돈방,
      (select count(*) from app.house_category)                              as 집계행,
      (select count(*) from app.medicine)                                    as 약품,
      (select count(*) from app.feed)                                        as 사료`);
  console.table(r.rows[0]);
} catch (e) {
  try { await client.query('ROLLBACK'); } catch { /* 연결이 끊겼을 수 있다 */ }
  console.error(`\n롤백했습니다. ${ok}개 파일까지 통과, ${path.basename(files[ok] ?? '?')} 에서 실패.`);
  await client.end().catch(() => {});
  process.exit(1);
}

await client.end();
