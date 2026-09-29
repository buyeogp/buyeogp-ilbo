/**
 * 폐사·도태 등록 창 — 설계문서 §4.7 · V7 · V10
 *
 * 일보 한 줄(돈방 × 축종)의 폐사·도태를 넣고 뺀다. 일보의 「폐사·도태」 칸은
 * 여기서 넣은 기록의 합이다 — 칸에 숫자를 바로 치게 하지 않는다(V7).
 *
 * 폐사는 사진이 있어야 끝난다(V10). 휴대폰에서 열면 사진 칸이 카메라를 바로 연다 —
 * 카톡으로 사진을 보내다 빠지던 것(D11)이 이 창이 막으려는 것이다.
 * 못 찍었으면 그 사유를 적고 24시간 안에 보완한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';
import { PhotoView } from './DeathLog.jsx';

const KIND = { mortality: '폐사', culling: '도태' };

/** 휴대폰 사진은 수 MB 다. 긴 변 1600px JPEG 로 줄여 보낸다 — 못 줄이면 원본 */
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
    return blob ?? file;
  } catch {
    return file;               // HEIC 처럼 브라우저가 못 여는 형식 — 서버가 그대로 받는다
  }
}

const hhmm = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function DeathPanel({ reportId, row, title, items, reasons, photoStorage,
                             canEdit, onClose, onChanged }) {
  const [kind, setKind] = useState('mortality');
  const [head, setHead] = useState('1');
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [earTag, setEarTag] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);          // { blob, url }
  const [noPhoto, setNoPhoto] = useState(false);
  const [waiver, setWaiver] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [askDel, setAskDel] = useState(null);
  const [view, setView] = useState(null);           // 크게 보는 사진
  const fileRef = useRef(null);
  const boxRef = useRef(null);

  const mine = useMemo(() => items.filter((x) =>
    String(x.penId ?? '') === String(row.penId ?? '')
    && String(x.categoryId ?? '') === String(row.categoryId ?? '')), [items, row]);

  const choices = reasons.filter((r) => r.kinds.includes(kind));
  const picked = reasons.find((r) => r.code === reason);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !view) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, view]);
  useEffect(() => { boxRef.current?.focus(); }, []);

  // 사유는 종류마다 다르다 (압사는 폐사만, 도태는 도태만)
  useEffect(() => {
    if (reason && !reasons.find((r) => r.code === reason)?.kinds.includes(kind)) setReason('');
  }, [kind, reason, reasons]);

  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const blob = await shrink(f);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
    setNoPhoto(false);
  };

  const n = Number(head);
  const problems = [];
  if (!Number.isInteger(n) || n < 1) problems.push('두수를 넣어 주십시오.');
  if (!picked) problems.push('사유를 골라 주십시오.');
  if (picked?.needsNote && !reasonNote.trim()) problems.push(`「${picked.name}」 사유를 적어 주십시오.`);
  if (kind === 'mortality' && !photo && !(noPhoto && waiver.trim())) {
    problems.push('사진을 넣거나, 못 찍었으면 그 사유를 적어 주십시오.');
  }

  const add = async () => {
    if (problems.length || busy) return;
    setBusy(true); setErr(null);
    try {
      let photoKey = null;
      if (kind === 'mortality' && photo) photoKey = (await api.photoUp(reportId, photo.blob)).photoKey;
      const r = await api.deathAdd(reportId, {
        kind, penId: row.penId, categoryId: row.categoryId, headCount: n,
        reasonCode: reason, reasonNote, earTag, note,
        photoKey, photoWaiver: kind === 'mortality' && !photoKey ? waiver : null,
      });
      onChanged({ add: r.item, row: r.row });
      setHead('1'); setReasonNote(''); setEarTag(''); setNote('');
      setPhoto(null); setNoPhoto(false); setWaiver('');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '등록하지 못했습니다.');
    } finally { setBusy(false); }
  };

  const del = async (x) => {
    setBusy(true); setErr(null); setAskDel(null);
    try {
      const r = await api.deathDel(reportId, x.kind, x.id);
      onChanged({ remove: x, row: r.row });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '빼지 못했습니다.');
    } finally { setBusy(false); }
  };

  // 「사진 없음」으로 넣은 폐사에 나중에 사진 붙이기 — 제출 뒤에도 된다(두수는 그대로)
  const [later, setLater] = useState(null);
  const laterRef = useRef(null);
  const attach = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !later) return;
    setBusy(true); setErr(null);
    try {
      const blob = await shrink(f);
      const { photoKey } = await api.photoUp(reportId, blob);
      const r = await api.photoAttach(reportId, later.id, photoKey);
      onChanged({ replace: r.item });
    } catch (er) {
      setErr(er instanceof ApiError ? er.message : '사진을 붙이지 못했습니다.');
    } finally { setBusy(false); setLater(null); }
  };

  const sum = (k) => mine.filter((x) => x.kind === k).reduce((a, x) => a + x.headCount, 0);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dpanel" role="dialog" aria-modal="true" aria-label={`${title} 폐사·도태`}
           tabIndex={-1} ref={boxRef}>
        <div className="dp-head">
          <h2>{title}</h2>
          <span className="dp-sum">폐사 <b>{sum('mortality')}</b> · 도태 <b>{sum('culling')}</b></span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>

        {mine.length > 0 ? (
          <ul className="dp-list">
            {mine.map((x) => (
              <li key={`${x.kind}-${x.id}`}>
                <span className={`dp-kind ${x.kind}`}>{KIND[x.kind]}</span>
                <b className="dp-n">{x.headCount}두</b>
                <span>{x.reasonName}{x.reasonNote ? ` — ${x.reasonNote}` : ''}</span>
                {x.earTag && <span className="dim">이각 {x.earTag}</span>}
                {x.kind === 'mortality' && (x.hasPhoto ? (
                  <button type="button" className="thumb" title="크게 보기"
                          onClick={() => setView({ src: api.photoSrc(reportId, x.id),
                            caption: `${title} · 폐사 ${x.headCount}두 · ${x.reasonName}` })}>
                    <img src={api.photoSrc(reportId, x.id)} alt={`${KIND[x.kind]} 사진`} />
                  </button>
                ) : (
                  <span className="dp-due">
                    사진 없음 · {hhmm(x.photoDueAt)}까지 보완
                    {canEdit !== 'none' && photoStorage && (
                      <button type="button" className="btn small"
                              onClick={() => { setLater(x); laterRef.current?.click(); }}>사진 붙이기</button>
                    )}
                  </span>
                ))}
                <span className="spacer" />
                {canEdit === true && (askDel === x ? (
                  <span className="dp-ask">
                    빼겠습니까?
                    <button type="button" className="btn small" onClick={() => setAskDel(null)}>그대로</button>
                    <button type="button" className="btn small danger" onClick={() => del(x)}>뺍니다</button>
                  </span>
                ) : (
                  <button type="button" className="btn small" disabled={busy}
                          onClick={() => setAskDel(x)}>빼기</button>
                ))}
              </li>
            ))}
          </ul>
        ) : <p className="dim dp-empty">이 줄에 등록된 폐사·도태가 없습니다.</p>}
        <input ref={laterRef} type="file" accept="image/*" capture="environment" hidden onChange={attach} />

        {canEdit === true ? (
          <div className="dp-form">
            <div className="dp-row">
              <span className="dp-lbl">종류</span>
              {Object.entries(KIND).map(([k, v]) => (
                <button key={k} type="button" className={kind === k ? 'chip sm on' : 'chip sm'}
                        onClick={() => setKind(k)}>{v}</button>
              ))}
            </div>
            <div className="dp-row">
              <label className="dp-lbl" htmlFor="dp-head">두수</label>
              <input id="dp-head" className="dp-num" inputMode="numeric" value={head}
                     onChange={(e) => setHead(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="dp-row">
              <span className="dp-lbl">사유</span>
              {choices.map((r) => (
                <button key={r.code} type="button" className={reason === r.code ? 'chip sm on' : 'chip sm'}
                        onClick={() => setReason(r.code)}>{r.code} {r.name}</button>
              ))}
            </div>
            {picked?.needsNote && (
              <div className="dp-row">
                <label className="dp-lbl" htmlFor="dp-rnote">기타 사유</label>
                <input id="dp-rnote" value={reasonNote} onChange={(e) => setReasonNote(e.target.value)}
                       placeholder="무엇 때문인지 적어 주십시오" />
              </div>
            )}
            {kind === 'mortality' && (
              <div className="dp-row top">
                <span className="dp-lbl">사진</span>
                <div className="dp-photo-box">
                  {photo ? (
                    <div className="dp-preview">
                      <img src={photo.url} alt="올릴 사진" />
                      <button type="button" className="btn small" onClick={() => setPhoto(null)}>다시 고르기</button>
                    </div>
                  ) : (
                    <button type="button" className="btn" disabled={!photoStorage || noPhoto}
                            onClick={() => fileRef.current?.click()}>사진 찍기 · 고르기</button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
                  {!photoStorage && (
                    <p className="dim">사진 저장소가 아직 연결되지 않았습니다. 아래에 사유를 적어 등록해 주십시오.</p>
                  )}
                  {!photo && (
                    <label className="dp-check">
                      <input type="checkbox" checked={noPhoto} onChange={(e) => setNoPhoto(e.target.checked)} />
                      사진을 못 찍었습니다 — <b>24시간 안에</b> 붙이겠습니다
                    </label>
                  )}
                  {noPhoto && !photo && (
                    <input value={waiver} onChange={(e) => setWaiver(e.target.value)}
                           placeholder="못 찍은 사유 (예: 휴대폰 배터리 없음)" />
                  )}
                </div>
              </div>
            )}
            <div className="dp-row">
              <label className="dp-lbl" htmlFor="dp-ear">이각번호</label>
              <input id="dp-ear" value={earTag} onChange={(e) => setEarTag(e.target.value)}
                     placeholder="있으면 (모돈 등)" />
            </div>
            <div className="dp-row">
              <label className="dp-lbl" htmlFor="dp-note">비고</label>
              <input id="dp-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {err && <p className="dp-err">{err}</p>}
            <div className="dp-actions">
              {problems.length > 0 && <span className="dim">{problems[0]}</span>}
              <span className="spacer" />
              <button type="button" className="btn primary" disabled={busy || problems.length > 0}
                      onClick={add}>
                {busy ? '등록 중…' : `${KIND[kind]} ${Number.isInteger(n) && n > 0 ? n : ''}두 등록`}
              </button>
            </div>
          </div>
        ) : (
          <>
            {err && <p className="dp-err">{err}</p>}
            <p className="dim dp-empty">
              {canEdit === 'photo'
                ? '제출된 일보라 폐사·도태를 넣거나 뺄 수 없습니다. 사진 보완만 됩니다.'
                : '보기만 할 수 있습니다. 등록은 담당 팀장이 작성 중인 일보에서 합니다.'}
            </p>
          </>
        )}
      </div>
      {view && <PhotoView src={view.src} caption={view.caption} onClose={() => setView(null)} />}
    </div>
  );
}
