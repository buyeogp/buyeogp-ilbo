/**
 * 설정 — infra/.env 를 읽는다.
 *
 * 값이 없으면 기동 시점에 죽는다. 운영 중에 「비밀번호가 undefined 였다」를
 * 발견하는 것보다 낫다.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
const ENV_FILE = path.join(ROOT, 'infra', '.env');

const file = {};
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    file[m[1]] = v;
  }
}
const env = { ...file, ...process.env };

function need(key) {
  const v = env[key];
  if (!v) throw new Error(`설정이 없습니다: ${key} (infra/.env 확인)`);
  return v;
}

export const config = {
  env: env.APP_ENV ?? 'development',
  port: Number(env.APP_PORT ?? 3000),
  baseUrl: env.APP_BASE_URL ?? 'http://localhost:3000',
  tz: env.TZ ?? 'Asia/Seoul',

  db: {
    host: need('DB_HOST'),
    port: Number(env.DB_PORT ?? 5432),
    // 운영은 buyeogp_app 소속 계정으로 붙는다. 소유자로 붙으면 RLS 가 통째로
    // 우회되므로(PostgreSQL 기본 동작) 여기를 postgres 로 두면 안 된다.
    user: need('DB_USER'),
    password: need('DB_PASSWORD'),
    database: env.DB_NAME ?? 'postgres',
    ssl: (env.DB_SSLMODE ?? 'require') === 'disable' ? false : { rejectUnauthorized: false },
    max: Number(env.DB_POOL_MAX ?? 10),
  },

  session: {
    cookie: 'buyeogp_sid',
    // §6.7 세션 만료 — 현장 15분 / 본사 30분
    idleFieldSec: Number(env.SESSION_TIMEOUT_FIELD_MIN ?? 15) * 60,
    idleHqSec: Number(env.SESSION_TIMEOUT_HQ_MIN ?? 30) * 60,
    absoluteHours: Number(env.SESSION_ABSOLUTE_HOURS ?? 12),
    secure: (env.APP_BASE_URL ?? '').startsWith('https://'),
  },

  report: {
    closeTime: env.REPORT_CLOSE_TIME ?? '18:30',
    remindTime: env.REPORT_REMIND_TIME ?? '18:00',
  },

  sentryDsn: env.SENTRY_DSN ?? '',
};

/** 본사 등급은 세션이 더 길다 (§6.7) */
export const idleLimitFor = (roles) =>
  roles.some((r) => r === 'hq_staff' || r === 'hq_manager' || r === 'admin' || r === 'auditor')
    ? config.session.idleHqSec
    : config.session.idleFieldSec;
