/**
 * 날짜 옮기기 — ‹ 전날 · [달력] · 다음날 › · 오늘
 *
 * 전날·다음날 단추만 있으면 3주 전 일보를 보려고 스무 번을 누르거나 주소창을 고쳐야 했다.
 * 미래 날짜는 고를 수 없다 — 내일 일보를 실수로 시작하면 오늘 일보가 막힌다(V5).
 */
import { shiftDate, today } from '../api.js';

// 연도를 키보드로 칠 때 「0002-09-29」 같은 값이 한 글자마다 들어온다 — 이보다 앞은 무시한다
const MIN = '2025-01-01';

export function DateNav({ date, onGo }) {
  const now = today();
  return (
    <span className="datenav">
      <button type="button" className="btn" onClick={() => onGo(shiftDate(date, -1))}>‹ 전날</button>
      <input type="date" id="date-pick" aria-label="날짜 고르기" value={date} min={MIN} max={now}
             onChange={(e) => { const v = e.target.value; if (v >= MIN && v <= now) onGo(v); }} />
      <button type="button" className="btn" disabled={date >= now}
              onClick={() => onGo(shiftDate(date, 1))}>다음날 ›</button>
      {date !== now && (
        <button type="button" className="btn" onClick={() => onGo(now)}>오늘</button>
      )}
    </span>
  );
}
