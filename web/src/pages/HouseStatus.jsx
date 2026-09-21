/**
 * 제출 현황 — 설계문서 §5.8
 *
 * 본사가 아침에 보는 한 장. 「어느 돈사가 아직 안 냈나」 하나만 답한다.
 * 색과 숫자로 말하고 문장은 쓰지 않는다.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, formatDate, shiftDate, STATUS_LABEL } from '../api.js';

const TONE = {
  confirmed: 'confirmed', locked: 'locked',
  submitted: 'submitted', draft: 'draft',
};

export function HouseStatus({ date }) {
  const nav = useNavigate();
  const [houses, setHouses] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let live = true;
    api.status(date)
      .then((s) => { if (live) setHouses(s.houses); })
      .catch((e) => { if (live) setErr(e instanceof ApiError ? e.message : '불러오지 못했습니다.'); });
    return () => { live = false; };
  }, [date]);

  if (err) return <div className="center">{err}</div>;
  if (!houses) return <div className="center">불러오는 중…</div>;

  const done = houses.filter((h) => h.status === 'confirmed' || h.status === 'locked').length;
  const late = houses.filter((h) => h.status === '미시작').length;

  return (
    <>
      <div className="house-banner">
        <h1>제출 현황</h1>
        <span className="date">{formatDate(date)}</span>
        <span className="badge confirmed">확정 {done} / {houses.length}</span>
        {late > 0 && <span className="badge draft">미시작 {late}</span>}
        <span className="spacer" />
        <button className="btn" onClick={() => nav(`/status/${shiftDate(date, -1)}`)}>‹ 전날</button>
        <button className="btn" onClick={() => nav(`/status/${shiftDate(date, 1)}`)}>다음날 ›</button>
      </div>

      <div className="grid-wrap fit">
        <table className="grid">
          <thead>
            <tr>
              <th className="rowhead">돈사</th>
              <th>입력</th>
              <th>상태</th>
              <th>제출</th>
              <th>확정</th>
              <th>출력</th>
            </tr>
          </thead>
          <tbody>
            {houses.map((h) => (
              <tr key={h.houseId} style={{ cursor: 'pointer' }}
                  onClick={() => nav(`/report/${h.houseId}/${date}`)}>
                <td className="rowhead">{h.name}</td>
                <td className="readonly">
                  <span className={h.entered >= h.expected ? 'chk ok' : 'chk bad'}>
                    {h.entered} / {h.expected}
                  </span>
                </td>
                <td className="readonly">
                  <span className={'badge ' + (TONE[h.status] ?? 'none')}>
                    {STATUS_LABEL[h.status] ?? h.status}
                  </span>
                </td>
                <td className="readonly">{time(h.submittedAt)}</td>
                <td className="readonly">{time(h.confirmedAt)}</td>
                <td className="readonly">{h.printedAt ? '출력됨' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint" style={{ marginTop: 10 }}>
        돈사를 누르면 그 날 일보로 갑니다.
      </p>
    </>
  );
}

function time(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
