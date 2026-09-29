/**
 * 일보 — /api/reports  (설계문서 §8.1)
 *
 * 화면은 현행 엑셀과 같은 행·열 구성이고, 팀장은 **변동분만** 넣는다.
 * 전일두수는 시스템이 채우고(V2) 당일두수는 생성열이 계산한다(V1).
 * 그래서 이 API 는 opening_head·closing_head 를 받지 않는다 — 받으면 안 된다.
 */
import { Router } from 'express';
import { tx } from '../../db/pool.js';
import { HttpError, requireAuth, requireRole, canAccessHouse, canWriteHouse, wrap }
  from '../middleware.js';

import { publish, publishSaved, reportHead } from '../../events.js';

export const reportsRouter = Router();

/** 알림 한 건 — 커밋 뒤에 보낸다 (롤백된 변경을 알리면 안 된다) */
const tell = (kind, head, user, extra = {}) => head && publish({
  kind, ...head, by: user.name, byId: user.userId, ...extra });
reportsRouter.use(requireAuth);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const int = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

/** 돈사별 제출 현황 — 본사 신호등 (§5.8) */
reportsRouter.get('/status', wrap(async (req, res) => {
  const date = DATE.test(req.query.date) ? req.query.date : null;
  const rows = await tx(req.user.userId, (q) => q.all(
    `SELECT h.id AS house_id, h.code, h.name, h.type::text, h.count_basis::text, h.seq,
            dr.id AS report_id, COALESCE(dr.status::text,'미시작') AS status,
            dr.submitted_at, dr.confirmed_at, dr.printed_at,
            (SELECT count(*)::int FROM app.pen_daily pd WHERE pd.report_id = dr.id) AS entered,
            (SELECT count(*)::int FROM app.pen p
              WHERE p.house_id = h.id AND p.active_from <= $1::date
                AND (p.active_to IS NULL OR p.active_to >= $1::date)) AS pens,
            (SELECT count(*)::int FROM app.house_category hc
              WHERE hc.house_id = h.id AND hc.active) AS cats
       FROM app.house h
       LEFT JOIN app.daily_report dr ON dr.house_id = h.id AND dr.report_date = $1::date
      WHERE h.active
      ORDER BY h.seq`, [date ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })]));

  // 볼 수 있는 돈사만. 전 돈사 등급이면 전부, 팀장이면 담당만.
  // RLS 는 app.house 를 막지 않으므로(마스터다) 여기서 걸러야 한다 — §6.7 전건 검사.
  res.json({ date, houses: rows
    .filter((r) => canAccessHouse(req.user, r.house_id))
    .map((r) => ({
      houseId: r.house_id, code: r.code, name: r.name, type: r.type,
      countBasis: r.count_basis, reportId: r.report_id, status: r.status,
      submittedAt: r.submitted_at, confirmedAt: r.confirmed_at, printedAt: r.printed_at,
      entered: r.entered, expected: expectedRows(r),
      canWrite: canWriteHouse(req.user, r.house_id),
    })) });
}));

/** count_basis 에 따라 있어야 할 행 수가 다르다 (L1-COMPLETE 와 같은 규칙) */
function expectedRows(r) {
  switch (r.count_basis) {
    case 'pen': return r.pens;
    case 'pen_category': return r.pens * r.cats;
    case 'category': return r.cats;
    case 'house': return 1;
    default: return r.pens;
  }
}

/**
 * 일보 한 건 — 그리드가 그대로 그릴 수 있는 형태로 준다.
 * 행이 아직 없으면 **있어야 할 행을 빈 값으로 만들어** 내려보낸다.
 * 화면이 「무엇을 채워야 하는가」를 스스로 알아내지 않게 한다.
 */
reportsRouter.get('/:houseId/:date', wrap(async (req, res) => {
  const { houseId, date } = req.params;
  if (!DATE.test(date)) throw new HttpError(400, 'bad_request', '날짜 형식이 올바르지 않습니다.');
  if (!canAccessHouse(req.user, houseId)) {
    throw new HttpError(403, 'forbidden', '볼 수 있는 돈사가 아닙니다.');
  }

  const out = await tx(req.user.userId, async (q) => {
    const house = await q.one(
      `SELECT id, farm_id, code, name, type::text, count_basis::text
         FROM app.house WHERE id = $1`, [houseId]);
    if (!house) throw new HttpError(404, 'not_found', '돈사를 찾을 수 없습니다.');

    const report = await q.one(
      `SELECT dr.id, dr.status::text, dr.author_id, dr.confirmed_by, dr.note_text,
              dr.submitted_at, dr.confirmed_at, dr.locked_at, dr.printed_at,
              dr.bulk_zero_rows, dr.bulk_zero_at,
              dr.return_reason, dr.returned_at, rb.name AS returned_by_name,
              a.name AS author_name, c.name AS confirmer_name
         FROM app.daily_report dr
         LEFT JOIN sec.app_user a ON a.id = dr.author_id
         LEFT JOIN sec.app_user c ON c.id = dr.confirmed_by
         LEFT JOIN sec.app_user rb ON rb.id = dr.returned_by
        WHERE dr.house_id = $1 AND dr.report_date = $2::date`, [houseId, date]);

    const saved = report ? await q.all(
      `SELECT pd.id, pd.pen_id, pd.batch_id, pd.category_id,
              pd.opening_head, pd.in_head, pd.out_head, pd.internal_out_head,
              pd.sold_head, pd.dead_head, pd.culled_head, pd.closing_head,
              pd.reported_closing_head, pd.variance, pd.variance_reason,
              pd.avg_weight_kg, pd.note
         FROM app.pen_daily pd WHERE pd.report_id = $1`, [report.id]) : [];

    // 있어야 할 행 골격
    const pens = await q.all(
      `SELECT id, code, seq FROM app.pen
        WHERE house_id = $1 AND active_from <= $2::date
          AND (active_to IS NULL OR active_to >= $2::date)
        ORDER BY seq`, [houseId, date]);
    const cats = await q.all(
      `SELECT c.id, c.code, c.name, hc.seq FROM app.house_category hc
         JOIN app.pig_category c ON c.id = hc.category_id
        WHERE hc.house_id = $1 AND hc.active ORDER BY hc.seq`, [houseId]);

    // 아직 저장 전인 행의 전일두수. V2 트리거가 채울 값을 **같은 규칙으로** 미리 본다.
    // 화면이 전일두수를 비워 두면 팀장이 아무것도 대조할 수 없다 (§8.1 「전일두수 자동」).
    // 규칙을 여기서 다시 쓰는 것이 아니라 011 의 V2 질의를 그대로 옮겨 온 것이다 —
    // 어긋나면 저장 직후 값이 바뀌어 바로 드러난다.
    const carried = new Map((await q.all(
      `SELECT DISTINCT ON (pd.pen_id, pd.batch_id, pd.category_id)
              pd.pen_id, pd.batch_id, pd.category_id, pd.closing_head
         FROM app.pen_daily pd
         JOIN app.daily_report d2 ON d2.id = pd.report_id
        WHERE pd.house_id = $1
          AND pd.report_date < $2::date
          AND d2.status IN ('confirmed','locked')
        ORDER BY pd.pen_id, pd.batch_id, pd.category_id, pd.report_date DESC`,
      [houseId, date])).map((r) => [`${r.pen_id ?? ''}|${r.category_id ?? ''}`, r.closing_head]));

    const skeleton = [];
    const basis = house.count_basis;
    if (basis === 'pen') {
      for (const p of pens) skeleton.push({ penId: p.id, penCode: p.code, categoryId: null });
    } else if (basis === 'pen_category') {
      for (const p of pens) for (const c of cats) {
        skeleton.push({ penId: p.id, penCode: p.code, categoryId: c.id, categoryName: c.name });
      }
    } else if (basis === 'category') {
      for (const c of cats) skeleton.push({ penId: null, categoryId: c.id, categoryName: c.name });
    } else {
      skeleton.push({ penId: null, categoryId: null });
    }

    const key = (r) => `${r.pen_id ?? r.penId ?? ''}|${r.category_id ?? r.categoryId ?? ''}`;
    const byKey = new Map(saved.map((r) => [key(r), r]));

    const rows = skeleton.map((sk) => {
      const s = byKey.get(key(sk));
      return {
        ...sk,
        rowLabel: sk.penCode ?? sk.categoryName ?? house.name,
        id: s?.id ?? null,
        openingHead: s?.opening_head ?? null,      // 시스템이 채운다. 화면은 읽기만
        expectedOpeningHead: carried.get(key(sk)) ?? 0,  // 저장 전에 보여 줄 값
        inHead: s?.in_head ?? null,
        outHead: s?.out_head ?? null,
        internalOutHead: s?.internal_out_head ?? null,
        soldHead: s?.sold_head ?? null,
        deadHead: s?.dead_head ?? null,            // 폐사 등록에서 파생 (V7)
        culledHead: s?.culled_head ?? null,        // 도태 등록에서 파생 (V7)
        closingHead: s?.closing_head ?? null,      // 생성열 (V1)
        reportedClosingHead: s?.reported_closing_head ?? null,
        varianceReason: s?.variance_reason ?? null,
        avgWeightKg: s?.avg_weight_kg ?? null,
        note: s?.note ?? null,
        filled: !!s,
      };
    });

    // 제출을 막고 있는 것들 — 화면이 미리 보여 준다 (§5.1 같은 함수를 쓴다)
    const violations = report ? await q.all(
      `SELECT rule_code, severity::text, pen_code, message
         FROM app.fn_validate_report($1)`, [report.id]) : [];

    return { house, report, rows, violations };
  });

  res.json({
    date,
    house: { id: out.house.id, code: out.house.code, name: out.house.name,
             type: out.house.type, countBasis: out.house.count_basis },
    report: out.report && {
      id: out.report.id, status: out.report.status,
      authorName: out.report.author_name, confirmerName: out.report.confirmer_name,
      noteText: out.report.note_text,
      submittedAt: out.report.submitted_at, confirmedAt: out.report.confirmed_at,
      lockedAt: out.report.locked_at, printedAt: out.report.printed_at,
      bulkZeroRows: out.report.bulk_zero_rows, bulkZeroAt: out.report.bulk_zero_at,
      returnReason: out.report.return_reason, returnedAt: out.report.returned_at,
      returnedBy: out.report.returned_by_name,
    },
    rows: out.rows,
    violations: out.violations.map((v) => ({
      ruleCode: v.rule_code, severity: v.severity, penCode: v.pen_code, message: v.message,
    })),
    canWrite: canWriteHouse(req.user, out.house.id)
      && (!out.report || out.report.status === 'draft'),
    // 제출 뒤에도 담당 팀장은 폐사 사진을 보완할 수 있다 (V10 24시간)
    canWriteHouse: canWriteHouse(req.user, out.house.id),
  });
}));

/** 일보를 연다. 없으면 만든다. V5 가 전일 확정을 강제한다. */
reportsRouter.post('/:houseId/:date/open', wrap(async (req, res) => {
  const { houseId, date } = req.params;
  if (!DATE.test(date)) throw new HttpError(400, 'bad_request', '날짜 형식이 올바르지 않습니다.');
  if (!canWriteHouse(req.user, houseId)) {
    throw new HttpError(403, 'forbidden', '담당 돈사가 아닙니다.');
  }

  const r = await tx(req.user.userId, async (q) => {
    const exist = await q.one(
      `SELECT id, status::text FROM app.daily_report
        WHERE house_id = $1 AND report_date = $2::date`, [houseId, date]);
    if (exist) return exist;

    const h = await q.one('SELECT farm_id FROM app.house WHERE id = $1', [houseId]);
    const made = await q.one(
      `INSERT INTO app.daily_report (farm_id, house_id, report_date, status, author_id)
       VALUES ($1,$2,$3::date,'draft',$4) RETURNING id, status::text`,
      [h.farm_id, houseId, date, req.user.userId]);
    return { ...made, head: await reportHead(q, made.id) };
  });
  if (r.head) tell('started', r.head, req.user);

  res.status(201).json({ reportId: r.id, status: r.status });
}));

/**
 * 두수 행 저장. 변동분만 받는다.
 * opening_head·closing_head·dead_head 는 받지 않는다 —
 * 각각 V2 트리거, 생성열, 폐사 원장이 정한다. 받으면 거짓말이 저장된다.
 */
reportsRouter.put('/:reportId/rows', wrap(async (req, res) => {
  const { reportId } = req.params;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) throw new HttpError(400, 'bad_request', '저장할 행이 없습니다.');

  const out = await tx(req.user.userId, async (q) => {
    const rep = await q.one(
      `SELECT dr.id, dr.house_id, dr.farm_id, dr.report_date, dr.status::text
         FROM app.daily_report dr WHERE dr.id = $1`, [reportId]);
    if (!rep) throw new HttpError(404, 'not_found', '일보를 찾을 수 없습니다.');
    if (!canWriteHouse(req.user, rep.house_id)) {
      throw new HttpError(403, 'forbidden', '담당 돈사가 아닙니다.');
    }
    if (rep.status !== 'draft') {
      throw new HttpError(409, 'not_draft',
        '제출·확정된 일보는 고칠 수 없습니다. 정정전표를 발행하십시오.');
    }

    for (const r of rows) {
      await q(
        `INSERT INTO app.pen_daily
           (report_id, farm_id, house_id, report_date, pen_id, batch_id, category_id,
            in_head, out_head, internal_out_head, sold_head,
            reported_closing_head, variance_reason, avg_weight_kg, note)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (report_id, pen_id, batch_id, category_id) DO UPDATE SET
            in_head = EXCLUDED.in_head,
            out_head = EXCLUDED.out_head,
            internal_out_head = EXCLUDED.internal_out_head,
            sold_head = EXCLUDED.sold_head,
            reported_closing_head = EXCLUDED.reported_closing_head,
            variance_reason = EXCLUDED.variance_reason,
            avg_weight_kg = EXCLUDED.avg_weight_kg,
            note = EXCLUDED.note`,
        [rep.id, rep.farm_id, rep.house_id, rep.report_date,
         r.penId ?? null, r.batchId ?? null, r.categoryId ?? null,
         int(r.inHead), int(r.outHead), int(r.internalOutHead), int(r.soldHead),
         r.reportedClosingHead === '' || r.reportedClosingHead == null
           ? null : Number(r.reportedClosingHead),
         r.varianceReason || null, r.avgWeightKg || null, r.note || null]);
    }

    // 「빈칸 0으로 채우기」 — 썼다는 사실을 남긴다 (025). 본사 확정 화면에 보인다
    const bulk = Number(req.body.bulkZero);
    if (Number.isInteger(bulk) && bulk > 0 && bulk <= 1000) {
      await q(`UPDATE app.daily_report
                  SET bulk_zero_rows = bulk_zero_rows + $2, bulk_zero_at = now()
                WHERE id = $1`, [rep.id, bulk]);
    }

    if (typeof req.body.noteText === 'string') {
      await q('UPDATE app.daily_report SET note_text = $2 WHERE id = $1',
        [rep.id, req.body.noteText]);
    }

    // 저장된 행의 **계산값만** 돌려준다.
    // 화면이 저장 뒤에 표를 통째로 다시 불러오면, 그 사이 다른 칸에 치고 있던
    // 내용이 날아간다. 자동저장에서는 그게 매번 일어난다.
    const computed = await q.all(
      `SELECT pd.pen_id, pd.category_id, pd.opening_head, pd.dead_head, pd.culled_head,
              pd.closing_head, pd.variance
         FROM app.pen_daily pd WHERE pd.report_id = $1`, [rep.id]);

    const v = await q.all(`SELECT rule_code, severity::text, pen_code, message
                             FROM app.fn_validate_report($1)`, [rep.id]);
    return { computed, violations: v, head: await reportHead(q, rep.id) };
  });
  publishSaved(out.head, req.user);

  res.json({
    saved: rows.length,
    // 시스템이 정하는 값만. 사람이 넣은 칸은 돌려보내지 않는다 — 덮어쓰면 안 된다
    rows: out.computed.map((r) => ({
      penId: r.pen_id, categoryId: r.category_id,
      openingHead: r.opening_head, deadHead: r.dead_head, culledHead: r.culled_head,
      closingHead: r.closing_head, variance: r.variance,
    })),
    violations: out.violations.map((v) => ({
      ruleCode: v.rule_code, severity: v.severity, penCode: v.pen_code, message: v.message,
    })),
    canSubmit: !out.violations.some((v) => v.severity === 'block'),
  });
}));

/** 제출. 검증에 걸리면 트리거가 막는다 — 여기서 미리 거르지 않는다 (기준이 갈리면 안 된다) */
reportsRouter.post('/:reportId/submit', wrap(async (req, res) => {
  const r = await tx(req.user.userId, async (q) => {
    const rep = await q.one(
      'SELECT id, house_id, status::text FROM app.daily_report WHERE id = $1',
      [req.params.reportId]);
    if (!rep) throw new HttpError(404, 'not_found', '일보를 찾을 수 없습니다.');
    if (!canWriteHouse(req.user, rep.house_id)) {
      throw new HttpError(403, 'forbidden', '담당 돈사가 아닙니다.');
    }
    const u = await q.one(
      `UPDATE app.daily_report
          SET status = 'submitted', submitted_at = now(),
              return_reason = NULL, returned_at = NULL, returned_by = NULL
        WHERE id = $1 RETURNING id, status::text, submitted_at`, [rep.id]);
    return { ...u, head: await reportHead(q, rep.id) };
  });
  tell('submitted', r.head, req.user);
  res.json({ reportId: r.id, status: r.status, submittedAt: r.submitted_at });
}));

/** 확정은 본사만. SoD-1 — 입력자는 자기 일보를 확정할 수 없다 (CHECK 가 막는다) */
reportsRouter.post('/:reportId/confirm', requireRole('hq_staff', 'hq_manager'),
  wrap(async (req, res) => {
    const r = await tx(req.user.userId, async (q) => {
      const u = await q.one(
        `UPDATE app.daily_report SET status = 'confirmed'
          WHERE id = $1 RETURNING id, status::text, confirmed_at`, [req.params.reportId]);
      return u && { ...u, head: await reportHead(q, u.id) };
    });
    if (!r) throw new HttpError(404, 'not_found', '일보를 찾을 수 없습니다.');
    tell('confirmed', r.head, req.user);
    res.json({ reportId: r.id, status: r.status, confirmedAt: r.confirmed_at });
  }));

/**
 * 뒤 날짜 일보가 이미 있으면 이 일보를 되돌리면 안 된다. 뒤 날짜의 전일두수(V2)는
 * 이 일보가 확정될 때의 당일두수로 이미 박혀 있다 — 여기를 고쳐도 따라가지 않는다.
 * 그 경우는 정정전표(뒤 날짜까지 다시 계산)로 간다.
 */
async function assertNoLater(q, reportId) {
  const later = await q.one(
    `SELECT n.report_date::text AS d FROM app.daily_report d
       JOIN app.daily_report n ON n.house_id = d.house_id AND n.report_date > d.report_date
      WHERE d.id = $1 ORDER BY n.report_date LIMIT 1`, [reportId]);
  if (later) {
    throw new HttpError(409, 'has_later',
      `다음 일보(${later.d})가 이미 있어 되돌릴 수 없습니다. 뒤 날짜 두수가 이 일보에서 이어졌기 때문입니다. `
      + '고쳐야 하면 정정전표로 합니다 — 테스트 기간에는 개발자에게 알려 주십시오.');
  }
}

/** 확정 해제 (§5.9) — 확정자·시각도 비운다. 다시 확정하는 사람이 확정자가 된다 */
reportsRouter.post('/:reportId/unconfirm',
  requireRole('farm_manager', 'hq_staff', 'hq_manager'), wrap(async (req, res) => {
    const r = await tx(req.user.userId, async (q) => {
      await assertNoLater(q, req.params.reportId);
      const u = await q.one(
        `UPDATE app.daily_report SET status = 'submitted', confirmed_by = NULL, confirmed_at = NULL
          WHERE id = $1 AND status = 'confirmed' RETURNING id, status::text, printed_at`,
        [req.params.reportId]);
      return u && { ...u, head: await reportHead(q, u.id) };
    });
    if (!r) throw new HttpError(409, 'not_confirmed', '확정된 일보가 아닙니다.');
    tell('unconfirmed', r.head, req.user);
    res.json({ reportId: r.id, status: r.status, wasPrinted: !!r.printed_at });
  }));

/** 제출 취소 — 팀장이 확정 전에 스스로 거둔다 */
reportsRouter.post('/:reportId/withdraw', wrap(async (req, res) => {
  const r = await tx(req.user.userId, async (q) => {
    const rep = await q.one(
      'SELECT id, house_id, status::text FROM app.daily_report WHERE id = $1', [req.params.reportId]);
    if (!rep) throw new HttpError(404, 'not_found', '일보를 찾을 수 없습니다.');
    if (!canWriteHouse(req.user, rep.house_id)) {
      throw new HttpError(403, 'forbidden', '담당 돈사가 아닙니다.');
    }
    if (rep.status !== 'submitted') {
      throw new HttpError(409, 'not_submitted', rep.status === 'draft'
        ? '아직 제출하지 않은 일보입니다.'
        : '이미 본사가 확정했습니다. 본사에 「확정 해제」를 부탁하십시오.');
    }
    await assertNoLater(q, rep.id);
    const u = await q.one(
      `UPDATE app.daily_report SET status = 'draft', submitted_at = NULL
        WHERE id = $1 RETURNING id, status::text`, [rep.id]);
    return { ...u, head: await reportHead(q, rep.id) };
  });
  tell('withdrawn', r.head, req.user);
  res.json({ reportId: r.id, status: r.status });
}));

/** 되돌려 보내기 — 본사가 사유를 붙여 팀장에게 돌려보낸다 (확정 전) */
reportsRouter.post('/:reportId/return',
  requireRole('farm_manager', 'hq_staff', 'hq_manager'), wrap(async (req, res) => {
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) throw new HttpError(422, 'need_reason', '무엇을 고쳐야 하는지 적어 주십시오.');
    const r = await tx(req.user.userId, async (q) => {
      const rep = await q.one(
        'SELECT id, house_id, status::text FROM app.daily_report WHERE id = $1', [req.params.reportId]);
      if (!rep) throw new HttpError(404, 'not_found', '일보를 찾을 수 없습니다.');
      if (!canAccessHouse(req.user, rep.house_id)) {
        throw new HttpError(403, 'forbidden', '볼 수 있는 돈사가 아닙니다.');
      }
      if (rep.status !== 'submitted') {
        throw new HttpError(409, 'not_submitted', rep.status === 'confirmed'
          ? '확정된 일보입니다. 먼저 「확정 해제」를 하십시오.'
          : '제출된 일보가 아닙니다.');
      }
      await assertNoLater(q, rep.id);
      const u = await q.one(
        `UPDATE app.daily_report
            SET status = 'draft', submitted_at = NULL,
                return_reason = $2, returned_at = now(), returned_by = $3
          WHERE id = $1 RETURNING id, status::text`, [rep.id, reason, req.user.userId]);
      return { ...u, head: await reportHead(q, rep.id) };
    });
    tell('returned', r.head, req.user, { note: reason });
    res.json({ reportId: r.id, status: r.status });
  }));
