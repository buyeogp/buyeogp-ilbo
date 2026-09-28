/**
 * DB 연결 — 이 파일이 시스템 권한 모델의 목줄이다.
 *
 * RLS 정책 74개가 전부 `app.session_user_id()` 하나를 본다. 그 값은
 * `SET LOCAL app.user_id` 로 트랜잭션마다 넣어 줘야 한다. 넣지 않으면
 * 아무것도 안 보이고(안전한 실패), 잘못 넣으면 남의 농장이 보인다.
 *
 * 그래서 업무 쿼리는 tx() 밖으로 나갈 수 없게 만들었다.
 * 풀에서 꺼낸 클라이언트를 직접 주지 않는다.
 */
import pg from 'pg';
import { config } from '../config.js';

// 두수는 정수다. pg 가 bigint(int8)를 문자열로 주는 것을 숫자로 받는다.
// 이 시스템의 최대값은 수만 단위라 안전하다.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// numeric 은 문자열로 둔다. 금액·중량에서 부동소수 오차가 나면 안 된다.

export const pool = new pg.Pool({
  ...config.db,
  application_name: 'buyeogp-api',
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (e) => {
  console.error('[db] 유휴 연결 오류:', e.message);
});

// 「오늘」은 한국 날짜다 (db/022). DB 기본값으로도 걸었지만, 풀러가 그 전에 열어 둔
// 연결을 다시 쓰면 UTC 가 남는다 — 연결마다 한 번 더 못박는다
const KST = "SET TIME ZONE 'Asia/Seoul'";
pool.on('connect', (c) => { c.query(KST).catch(() => {}); });

/**
 * 신원을 밝힌 트랜잭션. 업무 쿼리는 전부 이 안에서 돈다.
 *
 * @param {number|null} userId  sec.app_user.id. null 이면 아무것도 안 보인다
 * @param {(q) => Promise<any>} fn
 * @param {{migration?: boolean, adjustmentId?: number}} [opts]
 */
export async function tx(userId, fn, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL 이라 커밋·롤백과 함께 사라진다. 풀에 값이 새지 않는다.
    await client.query('SELECT set_config($1,$2,true)',
      ['app.user_id', userId == null ? '' : String(userId)]);
    if (opts.migration) {
      await client.query(`SELECT set_config('app.migration','on',true)`);
    }
    if (opts.adjustmentId) {
      await client.query('SELECT set_config($1,$2,true)',
        ['app.adjustment_id', String(opts.adjustmentId)]);
    }

    const q = (text, params) => client.query(text, params);
    q.one = async (text, params) => (await client.query(text, params)).rows[0] ?? null;
    q.all = async (text, params) => (await client.query(text, params)).rows;

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

/** 로그인처럼 아직 신원이 없는 작업용. sec 스키마만 만진다. */
export const anon = (fn) => tx(null, fn);

/** DB 가 돌려준 오류를 화면에 쓸 수 있는 말로 바꾼다 (§6.4 P10) */
export function describeDbError(e) {
  const msg = e?.message ?? '';
  // 트리거가 RAISE EXCEPTION 으로 한국어 메시지를 준다. 그대로 쓴다.
  if (/^(V\d|P\d|L\d|SoD|허용되지 않는|검증 위반|휴약기간|마스터에 없는)/.test(msg)) {
    return { status: 422, code: 'rule_violation', message: msg.split('\n')[0] };
  }
  switch (e?.code) {
    case '23505': return { status: 409, code: 'duplicate', message: '이미 있는 자료입니다.' };
    case '23503': return { status: 422, code: 'fk', message: '참조 대상이 없습니다.' };
    case '23514': return {
      status: 422, code: 'check',
      message: CHECK_MSG[e.constraint] ?? `값이 규칙에 맞지 않습니다 (${e.constraint}).`,
    };
    case '42501': return { status: 403, code: 'forbidden', message: '권한이 없습니다.' };
    default: return null;
  }
}

/** 제약 이름을 현장이 읽을 수 있는 문장으로 (§6.4 — 긴 문장보다 위치·숫자) */
const CHECK_MSG = {
  v3_no_negative_stock: '나간 두수가 있는 두수보다 많습니다.',
  v4_no_duplicate: '같은 돈방이 이미 입력되어 있습니다.',
  v6_live_born_nonneg: '사산·압사·미라·기형·도태·체미의 합이 총산보다 많습니다.',
  v10_photo_required: '폐사 사진이 필요합니다. 없으면 사유를 적어 주십시오.',
  l4_variance_needs_reason: '실사 두수가 다릅니다. 사유를 적어 주십시오.',
  sod1_author_ne_confirmer: '작성자와 확인자가 같을 수 없습니다.',
  sod2_issuer_ne_approver: '발행자와 승인자가 같을 수 없습니다.',
};

export async function close() {
  await pool.end();
}
