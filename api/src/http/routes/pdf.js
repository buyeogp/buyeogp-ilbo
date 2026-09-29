/**
 * 일보 PDF — GET /api/reports/:reportId/pdf  (설계문서 §6.5)
 *
 * HACCP 은 전자기록을 인정하지 않는다. 확정된 일보를 종이로 뽑아 서명하고 3년 둔다.
 *   · 확정·마감된 일보 → 공식 출력. printed_at 을 남기고 PDF 를 보관 버킷에 넣는다
 *   · 그 전 상태       → 「확정 전 미리보기」 워터마크. 기록을 남기지 않는다
 * 출력물 아래의 무결성 값(content_hash)은 같은 숫자면 같은 값이다 — 종이와 시스템이
 * 같다는 증명이다. 종이를 손으로 고치면 값이 맞지 않는다.
 *
 * Chromium 은 한 장 굽는 동안 300~500MB 를 쓴다. 2GB 서버에서 동시에 여러 장을
 * 굽지 않도록 한 번에 한 장씩 줄 세운다.
 */
import { Router } from 'express';
import { tx } from '../../db/pool.js';
import { HttpError, canAccessHouse, requireAuth, wrap } from '../middleware.js';
import { JONGBU_SHEET, combineJongbu, reportFromDb } from '../../pdf/fromDb.js';
import { contentHash as hashOf, htmlToPdf, renderPdf } from '../../pdf/render.js';
import { renderDayBundle } from '../../pdf/layout.js';
import { putFile } from '../../photos.js';
import { publish, reportHead } from '../../events.js';

export const pdfRouter = Router({ mergeParams: true });
pdfRouter.use(requireAuth);

let queue = Promise.resolve();
const oneAtATime = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

pdfRouter.get('/', wrap(async (req, res) => {
  const rp = await tx(req.user.userId, async (q) => {
    const head = await q.one(
      'SELECT house_id, farm_id FROM app.daily_report WHERE id = $1', [req.params.reportId]);
    if (!head) throw new HttpError(404, 'not_found', '일보를 찾을 수 없습니다.');
    if (!canAccessHouse(req.user, head.house_id)) {
      throw new HttpError(403, 'forbidden', '볼 수 있는 돈사가 아닙니다.');
    }
    const r = await reportFromDb(q, req.params.reportId);
    return { ...r, houseId: head.house_id, farmId: head.farm_id };
  });
  if (!rp.rows.length) {
    throw new HttpError(409, 'empty', '아직 입력된 줄이 없어 출력할 것이 없습니다.');
  }

  const official = rp.status === 'confirmed' || rp.status === 'locked';
  rp.preview = !official;

  const { pdf, contentHash } = await oneAtATime(() => renderPdf(rp));

  if (official) {
    // 출력 기록 — 제출 현황의 「출력」 칸이 이것을 본다
    const head = await tx(req.user.userId, async (q) => {
      await q('UPDATE app.daily_report SET printed_at = now() WHERE id = $1', [req.params.reportId]);
      return reportHead(q, req.params.reportId);
    });
    if (head) publish({ kind: 'printed', ...head, by: req.user.name, byId: req.user.userId });
    // 3년 보관본. 실패해도 종이 출력은 막지 않는다 — 사람이 기다리고 있다
    const key = `${rp.farmId}/${rp.houseId}/${rp.reportDate}/${rp.reportNo}-${contentHash.slice(0, 16)}.pdf`;
    putFile('daily-report-pdf', key, pdf, 'application/pdf')
      .then((ok) => { if (!ok) console.warn('[pdf] 보관 버킷이 설정되지 않아 보관하지 못했습니다', key); })
      .catch((e) => console.error('[pdf] 보관 실패', key, e.message));
  }

  const name = `${rp.reportNo}${official ? '' : '-미리보기'}.pdf`;
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.set('X-Content-Hash', contentHash);
  res.send(pdf);
}));

/**
 * 하루치 묶음 — GET /api/pdf/day?date=YYYY-MM-DD  (본사 보관철용)
 *
 * 그 날 **확정된** 일보만 돈사 순서대로 한 파일에 싣는다. 종부·임신사 네 돈사는
 * 엑셀처럼 한 장으로 합친다(넷 모두 확정됐을 때만 — 일부만이면 확정된 것만 합친다).
 * 확정 안 된 돈사가 있으면 맨 앞 쪽에 목록을 싣는다.
 * 실린 일보마다 출력 기록(printed_at)을 남긴다.
 */
export const dayPdfRouter = Router();
dayPdfRouter.use(requireAuth);

const WHY = { draft: '작성 중', submitted: '제출됨 · 확정 대기' };

dayPdfRouter.get('/day', wrap(async (req, res) => {
  const date = String(req.query.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError(400, 'bad_request', '날짜 형식이 올바르지 않습니다.');
  }

  const { sheets, missing, ids } = await tx(req.user.userId, async (q) => {
    const houses = (await q.all(
      `SELECT h.id, h.code, h.name, dr.id AS report_id, dr.status::text AS status
         FROM app.house h
         LEFT JOIN app.daily_report dr ON dr.house_id = h.id AND dr.report_date = $1::date
        WHERE h.active ORDER BY h.seq`, [date]))
      .filter((h) => canAccessHouse(req.user, h.id));

    const done = [];
    const miss = [];
    for (const h of houses) {
      if (h.status === 'confirmed' || h.status === 'locked') {
        done.push({ ...(await reportFromDb(q, h.report_id)), reportId: h.report_id });
      } else {
        miss.push({ name: h.name, why: WHY[h.status] ?? '일보 없음 (미시작)' });
      }
    }

    // 종부·임신사는 한 장으로 — 첫 돈사(순치사) 자리에
    const jb = done.filter((r) => JONGBU_SHEET.includes(r.house.code));
    const out = [];
    for (const r of done) {
      if (!JONGBU_SHEET.includes(r.house.code)) out.push(r);
      else if (r === jb[0]) out.push(jb.length > 1 ? combineJongbu(jb) : r);
    }
    return { sheets: out.filter((r) => r.rows.length), missing: miss, ids: done.map((r) => r.reportId) };
  });

  if (!sheets.length) {
    throw new HttpError(409, 'none', '이 날 확정된 일보가 없어 출력할 것이 없습니다.');
  }

  const printedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
  for (const s of sheets) { s.contentHash = hashOf(s); s.printedAt = printedAt; }
  const pdf = await oneAtATime(() => htmlToPdf(renderDayBundle(date, sheets, missing, printedAt)));

  await tx(req.user.userId, (q) =>
    q('UPDATE app.daily_report SET printed_at = now() WHERE id = ANY($1::bigint[])', [ids]));

  const name = `일보-${date}${missing.length ? `-${sheets.length}장(빠짐 ${missing.length})` : ''}.pdf`;
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.set('X-Sheets', String(sheets.length));
  res.set('X-Missing', String(missing.length));
  res.send(pdf);
}));
