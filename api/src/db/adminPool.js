/**
 * 계정 관리 전용 DB 연결 — 설계문서 §6.3 (SoD-3)
 *
 * 업무용 풀(`db/pool.js`)과 **다른 계정**으로 붙는다. 이 연결에는 일보·두수·
 * 폐사·출하가 GRANT 되어 있지 않다. 계정 관리 코드가 실수로든 고의로든 업무
 * 데이터를 건드릴 수 없다는 것이 코드 규약이 아니라 DB 가 강제하는 사실이 된다.
 *
 * 열려 있는 것은 넷뿐이다 — 계정·역할·담당·감사로그(쓰기 전용).
 * 돈사 이름(app.house)은 배정 화면에 필요해서 읽기만 열었다.
 */
import pg from 'pg';
import { config } from '../config.js';

let pool = null;

function ensure() {
  if (!config.dbAdmin.configured) {
    const e = new Error(
      '계정 관리 연결이 설정되지 않았습니다. 서버에서 `npm run setup:admin` 을 실행하십시오.');
    e.code = 'admin_not_configured';
    throw e;
  }
  pool ??= new pg.Pool({
    host: config.db.host,
    port: config.db.port,
    user: config.dbAdmin.user,
    password: config.dbAdmin.password,
    database: config.db.database,
    ssl: config.db.ssl,
    max: 4,                       // 계정 관리는 드물게 쓴다. 업무 풀을 굶기지 않는다
    application_name: 'buyeogp-admin',
  });
  return pool;
}

/**
 * 관리 트랜잭션. `actorId` 는 **누가 바꿨는지**다 — 감사로그에 그대로 들어간다.
 * 익명으로는 열 수 없다. 기록되지 않는 권한 변경이 있으면 안 된다 (§6.6).
 */
export async function atx(actorId, fn) {
  if (actorId == null) throw new Error('관리 작업에는 행위자가 필요합니다.');
  const client = await ensure().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1,$2,true)', ['app.user_id', String(actorId)]);

    const q = (text, params) => client.query(text, params);
    q.one = async (t, p) => (await client.query(t, p)).rows[0] ?? null;
    q.all = async (t, p) => (await client.query(t, p)).rows;

    /** 기록을 남긴다. 이 트랜잭션이 되돌아가면 기록도 함께 되돌아간다 — 맞는 동작이다. */
    q.log = (action, table, pk, detail) => client.query(
      `INSERT INTO sec.audit_log (user_id, action, table_name, pk_value, detail)
       VALUES ($1,$2,$3,$4,$5)`, [actorId, action, table, pk == null ? null : String(pk), detail]);

    const out = await fn(q);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export const adminConfigured = () => config.dbAdmin.configured;

export async function closeAdmin() {
  if (pool) { await pool.end(); pool = null; }
}
