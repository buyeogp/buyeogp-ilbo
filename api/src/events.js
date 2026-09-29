/**
 * 실시간 알림 — GET /api/events (Server-Sent Events, 설계문서 §5.8)
 *
 * 팀장이 제출하면 본사 화면이 새로고침 없이 바뀌고 구석에 「자돈사 9/29 제출됨」이 뜬다.
 *
 * 원칙
 *   · 알림에는 **무엇이 바뀌었는지(돈사·날짜·종류)만** 싣는다. 숫자는 싣지 않는다 —
 *     화면이 기존 API 로 다시 받아 오고, 거기서 권한 검사를 거친다
 *   · 볼 수 있는 돈사의 알림만 보낸다 (canAccessHouse)
 *   · 연결이 열려 있는 것은 「활동」이 아니다. 무조작 로그아웃(§6.7)을 막지 않도록
 *     세션을 밀지 않고, 세션이 끝나면 연결을 닫는다
 *   · 끊길 수 있다고 본다. 끊긴 동안의 알림은 사라진다 — 화면은 다시 연결되는 순간
 *     한 번 새로 받는다. 25초마다 빈 신호를 보내 중간 장비가 조용한 연결을 끊지 않게 한다
 *   · 서버가 한 대라 알림은 이 프로세스 안에서만 돈다 (DB 를 직접 고친 변경은 안 나간다)
 */
import { canAccessHouse } from './http/middleware.js';
import { sessionAlive } from './auth/session.js';

const clients = new Set();
let seq = 0;

const PING_MS = 25_000;
const CHECK_EVERY = 4;          // 핑 4번(약 100초)마다 세션이 살아 있는지 본다
let beat = 0;

setInterval(async () => {
  beat += 1;
  for (const c of clients) c.res.write(': ping\n\n');
  if (beat % CHECK_EVERY) return;
  for (const c of [...clients]) {
    try {
      if (!(await sessionAlive(c.sessionId))) {
        c.res.write('event: bye\ndata: {"reason":"session"}\n\n');
        c.res.end();
        clients.delete(c);
      }
    } catch { /* DB 가 잠깐 안 되면 다음 차례에 본다 */ }
  }
}, PING_MS).unref();

export function subscribe(req, res) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform — 중간(Caddy)이 압축하려고 모아 두지 않게
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  // 끊기면 브라우저가 5초 뒤 다시 붙는다
  res.write('retry: 5000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const c = { res, user: req.user, sessionId: req.user.sessionId };
  clients.add(c);
  req.on('close', () => clients.delete(c));
}

/**
 * @param {{kind: string, houseId: string|number, houseName?: string, date: string,
 *          reportId?: string|number, status?: string, by?: string, byId?: string|number,
 *          note?: string}} ev
 */
export function publish(ev) {
  const id = ++seq;
  const data = JSON.stringify({ ...ev, at: new Date().toISOString() });
  for (const c of clients) {
    if (!canAccessHouse(c.user, ev.houseId)) continue;
    c.res.write(`id: ${id}\nevent: change\ndata: ${data}\n\n`);
  }
}

/** 일보 한 건의 알림 머리 — 신원을 밝힌 트랜잭션 안에서 부른다 (돈사 이름은 RLS 뒤에 있다) */
export async function reportHead(q, reportId) {
  return q.one(
    `SELECT dr.id AS "reportId", dr.house_id AS "houseId", h.name AS "houseName",
            dr.report_date::text AS date, dr.status::text AS status
       FROM app.daily_report dr JOIN app.house h ON h.id = dr.house_id
      WHERE dr.id = $1`, [reportId]);
}

/** 자동 저장은 1~2초마다 온다. 같은 일보는 15초에 한 번만 알린다 */
const lastSaved = new Map();
export function publishSaved(head, user) {
  const now = Date.now();
  if (now - (lastSaved.get(String(head.reportId)) ?? 0) < 15_000) return;
  lastSaved.set(String(head.reportId), now);
  publish({ kind: 'saved', ...head, by: user.name, byId: user.userId });
}

export const liveCount = () => clients.size;
