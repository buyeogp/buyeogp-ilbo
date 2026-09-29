/**
 * 폐사·도태 등록 — /api/reports/:reportId/deaths  (설계문서 §4.7 · V7 · V10)
 *
 * 일보의 「폐사·도태」 칸은 여기서만 채워진다. 칸에 숫자를 직접 넣게 하지 않는 이유는
 * 두수가 사유별 원장의 합이어야 하기 때문이다(V7) — DB 트리거가 원장이 바뀔 때마다
 * 일보 행을 다시 센다. 이 API 는 원장에 넣고 지우기만 한다.
 *
 * 폐사는 사진이 있어야 끝난다(V10). 사진이 없으면 사유를 남기고 24시간 안에 보완한다.
 * 카톡으로 사진을 보내다 빠지던 것(D11)을 시스템이 막는다.
 */
import express, { Router } from 'express';
import { tx } from '../../db/pool.js';
import { HttpError, canAccessHouse, canWriteHouse, requireAuth, wrap } from '../middleware.js';
import { TYPES, canStore, getPhoto, putPhoto } from '../../photos.js';

export const deathsRouter = Router({ mergeParams: true });
deathsRouter.use(requireAuth);

const KINDS = { mortality: '폐사', culling: '도태' };
const kindOf = (k) => {
  if (!KINDS[k]) throw new HttpError(400, 'bad_request', '폐사인지 도태인지 골라 주십시오.');
  return k;
};

/** 일보와 권한을 한 번에 본다. write 면 작성 중(draft)이어야 한다 */
async function reportFor(q, req, { write = false } = {}) {
  const r = await q.one(
    `SELECT id, farm_id, house_id, report_date::text AS d, status::text
       FROM app.daily_report WHERE id = $1`, [req.params.reportId]);
  if (!r) throw new HttpError(404, 'not_found', '일보를 찾을 수 없습니다.');
  if (!canAccessHouse(req.user, r.house_id)) {
    throw new HttpError(403, 'forbidden', '볼 수 있는 돈사가 아닙니다.');
  }
  if (write) {
    if (!canWriteHouse(req.user, r.house_id)) {
      throw new HttpError(403, 'forbidden', '담당 돈사가 아닙니다.');
    }
    if (r.status !== 'draft') {
      throw new HttpError(409, 'locked',
        '제출된 일보에는 폐사·도태를 넣거나 뺄 수 없습니다. 고쳐야 하면 본사에 알려 주십시오.');
    }
  }
  return r;
}

/** 그 줄(돈방 × 축종)의 폐사·도태 합계 — 화면이 줄을 바로 고칠 수 있게 */
async function rowSums(q, r, penId, categoryId) {
  const s = await q.one(
    `SELECT
       (SELECT COALESCE(SUM(head_count), 0) FROM app.mortality
         WHERE house_id = $1 AND event_date = $2::date
           AND pen_id IS NOT DISTINCT FROM $3 AND category_id IS NOT DISTINCT FROM $4)::int AS dead,
       (SELECT COALESCE(SUM(head_count), 0) FROM app.culling
         WHERE house_id = $1 AND event_date = $2::date
           AND pen_id IS NOT DISTINCT FROM $3 AND category_id IS NOT DISTINCT FROM $4)::int AS culled`,
    [r.house_id, r.d, penId, categoryId]);
  return { penId, categoryId, deadHead: s.dead, culledHead: s.culled };
}

const shape = (x) => ({
  kind: x.kind, id: x.id,
  penId: x.pen_id, categoryId: x.category_id,
  headCount: x.head_count,
  reasonCode: x.code, reasonName: x.reason_name, reasonNote: x.reason_note,
  earTag: x.ear_tag, note: x.note,
  hasPhoto: !!x.photo_url, photoWaiver: x.photo_waiver, photoDueAt: x.photo_due_at,
  createdBy: x.created_by_name, createdAt: x.created_at,
});

const LIST = (where) => `
  SELECT 'mortality' AS kind, m.id, m.pen_id, m.category_id, m.head_count,
         rc.code, rc.name AS reason_name, m.reason_note, m.ear_tag, m.note,
         m.photo_url, m.photo_waiver, m.photo_due_at, u.name AS created_by_name, m.created_at
    FROM app.mortality m
    JOIN app.reason_code rc ON rc.id = m.reason_code_id
    LEFT JOIN sec.app_user u ON u.id = m.created_by
   WHERE ${where.replaceAll('X.', 'm.')}
  UNION ALL
  SELECT 'culling', c.id, c.pen_id, c.category_id, c.head_count,
         rc.code, rc.name, c.reason_note, c.ear_tag, c.note,
         NULL, NULL, NULL, u.name, c.created_at
    FROM app.culling c
    JOIN app.reason_code rc ON rc.id = c.reason_code_id
    LEFT JOIN sec.app_user u ON u.id = c.created_by
   WHERE ${where.replaceAll('X.', 'c.')}
   ORDER BY created_at`;

/** 그 일보의 폐사·도태 전부 + 고를 수 있는 사유 */
deathsRouter.get('/', wrap(async (req, res) => {
  const out = await tx(req.user.userId, async (q) => {
    const r = await reportFor(q, req);
    const items = await q.all(LIST('X.house_id = $1 AND X.event_date = $2::date'),
      [r.house_id, r.d]);
    const reasons = await q.all(
      `SELECT code, name, scope, needs_note FROM app.reason_code WHERE active ORDER BY seq`);
    return { items, reasons };
  });
  res.json({
    items: out.items.map(shape),
    reasons: out.reasons.map((x) => ({
      code: x.code, name: x.name, needsNote: x.needs_note,
      kinds: x.scope === 'both' ? ['mortality', 'culling'] : [x.scope],
    })),
    photoStorage: canStore(),
  });
}));

/**
 * 사진 올리기. 본문이 그림 파일 그대로다(multipart 가 아니다) — 받는 쪽이 단순하다.
 * 돌려준 키를 등록할 때 photoKey 로 넘긴다.
 */
deathsRouter.post('/photo',
  express.raw({ type: Object.keys(TYPES), limit: '10mb' }),
  wrap(async (req, res) => {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim();
    if (!TYPES[type] || !Buffer.isBuffer(req.body) || !req.body.length) {
      throw new HttpError(415, 'bad_type', '사진 파일(JPG·PNG·WEBP·HEIC)만 올릴 수 있습니다.');
    }
    if (!canStore()) {
      throw new HttpError(503, 'no_storage',
        '사진 저장소가 아직 연결되지 않았습니다. 「사진 없음」 사유를 적고 등록해 주십시오.');
    }
    const r = await tx(req.user.userId, (q) => reportFor(q, req));
    if (!canWriteHouse(req.user, r.house_id)) {
      throw new HttpError(403, 'forbidden', '담당 돈사가 아닙니다.');
    }
    const key = await putPhoto(req.body, type, `${r.farm_id}/${r.house_id}/${r.d}`);
    res.status(201).json({ photoKey: key });
  }));

/** 등록 */
deathsRouter.post('/', wrap(async (req, res) => {
  const b = req.body ?? {};
  const kind = kindOf(b.kind);
  const head = Number(b.headCount);
  if (!Number.isInteger(head) || head < 1 || head > 9999) {
    throw new HttpError(422, 'bad_count', '두수는 1 이상의 정수로 넣어 주십시오.');
  }
  const reasonNote = String(b.reasonNote ?? '').trim() || null;
  const earTag = String(b.earTag ?? '').trim() || null;
  const note = String(b.note ?? '').trim() || null;
  const photoKey = b.photoKey ? String(b.photoKey) : null;
  const waiver = String(b.photoWaiver ?? '').trim() || null;

  const out = await tx(req.user.userId, async (q) => {
    const r = await reportFor(q, req, { write: true });

    // 그 줄이 이 돈사의 줄인지 — 다른 돈사 돈방을 끼워 넣지 못하게
    const penId = b.penId ?? null;
    const categoryId = b.categoryId ?? null;
    if (penId != null) {
      const p = await q.one('SELECT id FROM app.pen WHERE id = $1 AND house_id = $2', [penId, r.house_id]);
      if (!p) throw new HttpError(422, 'bad_row', '이 돈사의 돈방이 아닙니다.');
    }
    if (categoryId != null) {
      const c = await q.one(
        'SELECT 1 FROM app.house_category WHERE house_id = $1 AND category_id = $2',
        [r.house_id, categoryId]);
      if (!c) throw new HttpError(422, 'bad_row', '이 돈사의 축종이 아닙니다.');
    }

    const rc = await q.one(
      'SELECT id, name, scope, needs_note FROM app.reason_code WHERE code = $1 AND active',
      [String(b.reasonCode ?? '')]);
    if (!rc || (rc.scope !== 'both' && rc.scope !== kind)) {
      throw new HttpError(422, 'bad_reason', `${KINDS[kind]} 사유를 골라 주십시오.`);
    }
    if (rc.needs_note && !reasonNote) {
      throw new HttpError(422, 'need_note', `「${rc.name}」을 고르면 사유를 적어야 합니다.`);
    }

    let row;
    if (kind === 'mortality') {
      // V10 — 사진 또는 (사유 + 24시간 보완 기한)
      if (photoKey && !photoKey.startsWith(`${r.farm_id}/${r.house_id}/${r.d}/`)) {
        throw new HttpError(422, 'bad_photo', '이 일보에 올린 사진이 아닙니다.');
      }
      if (!photoKey && !waiver) {
        throw new HttpError(422, 'need_photo',
          '폐사는 사진이 있어야 등록됩니다. 사진을 올리거나, 못 찍었으면 그 사유를 적어 주십시오.');
      }
      row = await q.one(
        `INSERT INTO app.mortality
           (farm_id, event_date, house_id, pen_id, category_id, head_count,
            reason_code_id, reason_note, ear_tag, photo_url, photo_waiver, photo_due_at,
            note, created_by)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 CASE WHEN $10::text IS NULL THEN now() + interval '24 hours' END,
                 $12,$13)
         RETURNING id`,
        [r.farm_id, r.d, r.house_id, penId, categoryId, head, rc.id, reasonNote, earTag,
         photoKey, photoKey ? null : waiver, note, req.user.userId]);
    } else {
      row = await q.one(
        `INSERT INTO app.culling
           (farm_id, event_date, house_id, pen_id, category_id, head_count,
            reason_code_id, reason_note, ear_tag, note, created_by)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [r.farm_id, r.d, r.house_id, penId, categoryId, head, rc.id, reasonNote, earTag,
         note, req.user.userId]);
    }
    // 폐사와 도태는 번호가 따로 매겨진다 — 같은 번호가 둘 다 있을 수 있어 종류로 고른다
    const item = (await q.all(LIST('X.id = $1'), [row.id])).find((x) => x.kind === kind);
    return { item, row: await rowSums(q, r, penId, categoryId) };
  });

  res.status(201).json({ item: shape(out.item), row: out.row });
}));

/** 빼기 — 작성 중인 일보에서만 */
deathsRouter.delete('/:kind/:id', wrap(async (req, res) => {
  const kind = kindOf(req.params.kind);
  const out = await tx(req.user.userId, async (q) => {
    const r = await reportFor(q, req, { write: true });
    const gone = await q.one(
      `DELETE FROM app.${kind} WHERE id = $1 AND house_id = $2 AND event_date = $3::date
       RETURNING pen_id, category_id`, [req.params.id, r.house_id, r.d]);
    if (!gone) throw new HttpError(404, 'not_found', '이미 빠졌거나 없는 기록입니다.');
    return rowSums(q, r, gone.pen_id, gone.category_id);
  });
  res.json({ row: out });
}));

/**
 * 사진 보완 — 「사진 없음」으로 등록한 폐사에 나중에 붙인다 (V10 24시간).
 * 두수는 바뀌지 않으므로 제출·확정 뒤에도 된다.
 */
deathsRouter.post('/mortality/:id/photo', wrap(async (req, res) => {
  const photoKey = String(req.body?.photoKey ?? '');
  const out = await tx(req.user.userId, async (q) => {
    const r = await reportFor(q, req);
    if (!canWriteHouse(req.user, r.house_id)) {
      throw new HttpError(403, 'forbidden', '담당 돈사가 아닙니다.');
    }
    if (!photoKey.startsWith(`${r.farm_id}/${r.house_id}/${r.d}/`)) {
      throw new HttpError(422, 'bad_photo', '이 일보에 올린 사진이 아닙니다.');
    }
    const u = await q.one(
      `UPDATE app.mortality SET photo_url = $3
        WHERE id = $1 AND house_id = $2 AND event_date = $4::date RETURNING id`,
      [req.params.id, r.house_id, photoKey, r.d]);
    if (!u) throw new HttpError(404, 'not_found', '폐사 기록을 찾을 수 없습니다.');
    return (await q.all(LIST('X.id = $1'), [u.id])).find((x) => x.kind === 'mortality');
  });
  res.json({ item: shape(out) });
}));

/** 사진 보기 — URL 을 내주지 않고 권한을 본 뒤 대신 읽어 보낸다 */
deathsRouter.get('/mortality/:id/photo', wrap(async (req, res) => {
  const key = await tx(req.user.userId, async (q) => {
    const r = await reportFor(q, req);
    const m = await q.one(
      'SELECT photo_url FROM app.mortality WHERE id = $1 AND house_id = $2 AND event_date = $3::date',
      [req.params.id, r.house_id, r.d]);
    if (!m?.photo_url) throw new HttpError(404, 'not_found', '사진이 없습니다.');
    return m.photo_url;
  });
  const p = await getPhoto(key);
  res.set('Content-Type', p.type);
  res.set('Cache-Control', 'private, max-age=3600');
  if (Buffer.isBuffer(p.body)) return res.send(p.body);
  // S3 응답은 스트림이다
  const buf = Buffer.from(await p.body.transformToByteArray());
  res.send(buf);
}));
