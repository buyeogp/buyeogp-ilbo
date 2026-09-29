/**
 * 폐사·도태 일지 + 사진 크게 보기 — 설계문서 §4.7 · §10 「폐사일지 / 도태일지」
 *
 * 줄마다 칸을 눌러야 사진이 보이면 본사는 「오늘 어디서 몇 마리, 사진은 다 붙었나」를
 * 확인할 수 없다. 한 날짜를 한 장으로 모은다. 사진이 빠진 건은 맨 위에 올린다.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, formatDate } from '../api.js';

const KIND = { mortality: '폐사', culling: '도태' };

const hhmm = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 사진 크게 보기. 새 탭이 아니라 그 자리에 띄우고, 닫으면 하던 곳으로 돌아간다 */
export function PhotoView({ src, caption, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="사진 크게 보기"
         onMouseDown={onClose}>
      <figure onMouseDown={(e) => e.stopPropagation()}>
        <img src={src} alt={caption} />
        <figcaption>
          <span>{caption}</span>
          <span className="spacer" />
          <a className="btn small" href={src} target="_blank" rel="noreferrer">원본 열기</a>
          <button type="button" className="btn small" onClick={onClose} autoFocus>닫기</button>
        </figcaption>
      </figure>
    </div>
  );
}

/** 한 날짜의 폐사·도태. houseId 가 있으면 그 돈사만 */
export function DeathLog({ date, houseId, title, onClose, onOpenReport }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState(null);

  useEffect(() => {
    let live = true;
    api.deathLog(date, houseId)
      .then((r) => { if (live) setItems(r.items); })
      .catch((e) => { if (live) setErr(e instanceof ApiError ? e.message : '불러오지 못했습니다.'); });
    return () => { live = false; };
  }, [date, houseId]);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !view) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, view]);

  const list = items ?? [];
  const due = list.filter((x) => x.kind === 'mortality' && !x.hasPhoto);
  const sum = (k) => list.filter((x) => x.kind === k).reduce((a, x) => a + x.headCount, 0);

  // 돈사별로 묶는다. 사진 보완이 남은 돈사가 위로
  const houses = [];
  for (const x of list) {
    let h = houses.find((y) => y.id === x.houseId);
    if (!h) { h = { id: x.houseId, name: x.houseName, rows: [] }; houses.push(h); }
    h.rows.push(x);
  }
  houses.sort((a, b) => Number(b.rows.some((x) => x.kind === 'mortality' && !x.hasPhoto))
                      - Number(a.rows.some((x) => x.kind === 'mortality' && !x.hasPhoto)));

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dpanel wide" role="dialog" aria-modal="true" aria-label="폐사·도태 일지" tabIndex={-1}>
        <div className="dp-head">
          <h2>{title ?? '폐사·도태 일지'}</h2>
          <span className="dp-sum">{formatDate(date)}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>

        {err && <p className="dp-err">{err}</p>}
        {!items && !err && <p className="dim">불러오는 중…</p>}

        {items && (
          <p className="dl-summary">
            폐사 <b>{sum('mortality')}</b>두 · 도태 <b>{sum('culling')}</b>두
            <span className="dim"> ({list.length}건)</span>
            {due.length > 0
              ? <span className="dl-due"> · 사진 보완 필요 <b>{due.length}</b>건</span>
              : list.some((x) => x.kind === 'mortality') && <span className="dl-ok"> · 폐사 사진 모두 있음</span>}
          </p>
        )}
        {items && list.length === 0 && <p className="dim dp-empty">이 날 등록된 폐사·도태가 없습니다.</p>}

        {houses.map((h) => (
          <section key={h.id} className="dl-house">
            <h3>
              {h.name}
              <span className="dim"> 폐사 {h.rows.filter((x) => x.kind === 'mortality').reduce((a, x) => a + x.headCount, 0)}
                · 도태 {h.rows.filter((x) => x.kind === 'culling').reduce((a, x) => a + x.headCount, 0)}</span>
              {onOpenReport && (
                <button type="button" className="btn small" onClick={() => onOpenReport(h.id)}>일보 열기</button>
              )}
            </h3>
            <div className="tbl-scroll">
              <table className="k dl-table">
                <thead>
                  <tr><th>돈방 · 축종</th><th>종류</th><th>두수</th><th>사유</th><th>이각번호</th><th>사진</th><th>등록</th></tr>
                </thead>
                <tbody>
                  {h.rows.map((x) => {
                    const label = [x.penCode, x.categoryName].filter(Boolean).join(' · ') || h.name;
                    return (
                      <tr key={`${x.kind}-${x.id}`}>
                        <td>{label}</td>
                        <td><span className={`dp-kind ${x.kind}`}>{KIND[x.kind]}</span></td>
                        <td className="num">{x.headCount}</td>
                        <td>{x.reasonName}{x.reasonNote ? ` — ${x.reasonNote}` : ''}</td>
                        <td>{x.earTag ?? ''}</td>
                        <td>
                          {x.kind !== 'mortality' ? <span className="dim">—</span>
                            : x.hasPhoto ? (
                              <button type="button" className="thumb"
                                      onClick={() => setView({ src: api.photoSrc(x.reportId, x.id),
                                        caption: `${h.name} ${label} · 폐사 ${x.headCount}두 · ${x.reasonName}` })}>
                                <img src={api.photoSrc(x.reportId, x.id)} alt={`${label} 폐사 사진`} loading="lazy" />
                              </button>
                            ) : (
                              <span className="dp-due" title={x.photoWaiver ?? ''}>
                                없음 · {hhmm(x.photoDueAt)}까지
                              </span>
                            )}
                        </td>
                        <td className="dim">{x.createdBy} {hhmm(x.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      {view && <PhotoView src={view.src} caption={view.caption} onClose={() => setView(null)} />}
    </div>
  );
}
