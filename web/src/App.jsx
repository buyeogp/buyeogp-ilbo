/**
 * 화면 껍데기.
 *
 * 권한으로 메뉴를 숨기지만 그건 UX 일 뿐이다 — 막는 것은 서버다 (§6.7).
 * 그래서 여기서는 「보여 줄 것을 고르는」 일만 한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, today } from './api.js';
import { Login } from './pages/Login.jsx';
import { DailyReport } from './pages/DailyReport.jsx';
import { HouseStatus } from './pages/HouseStatus.jsx';

const FARM_WIDE = ['farm_manager', 'hq_staff', 'hq_manager', 'auditor'];

export function App() {
  const [me, setMe] = useState(undefined);   // undefined = 확인 중, null = 미로그인

  const refresh = useCallback(
    () => api.me().then(setMe).catch(() => setMe(null)), []);

  useEffect(() => { refresh(); }, [refresh]);

  if (me === undefined) return <div className="center">불러오는 중…</div>;
  if (me === null) return <Login onDone={refresh} />;
  return <Shell me={me} onSignedOut={() => setMe(null)} />;
}

function Shell({ me, onSignedOut }) {
  const farmWide = me.user.roles.some((r) => FARM_WIDE.includes(r));
  const myHouses = me.scopes.filter((s) => s.houseId != null);

  // 돈사 목록·제출 현황은 한 번에 받는다. 팀장은 자기 돈사만 걸러 보여 준다.
  const [date, setDate] = useState(today());
  const [houses, setHouses] = useState([]);

  const loadStatus = useCallback(async (d) => {
    try {
      const s = await api.status(d);
      setHouses(farmWide ? s.houses
        : s.houses.filter((h) => myHouses.some((m) => String(m.houseId) === String(h.houseId))));
    } catch { setHouses([]); }
  }, [farmWide, JSON.stringify(myHouses)]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadStatus(date); }, [date, loadStatus]);

  const home = houses[0]
    ? `/report/${houses[0].houseId}/${date}`
    : (myHouses[0] ? `/report/${myHouses[0].houseId}/${date}` : `/status/${date}`);

  return (
    <div className="shell">
      <TopBar me={me} houses={houses} date={date} farmWide={farmWide}
              onSignedOut={onSignedOut} />
      <main>
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/report/:houseId/:date"
                 element={<ReportRoute me={me} onDate={setDate}
                                       onChanged={() => loadStatus(date)} />} />
          <Route path="/status/:date"
                 element={<StatusRoute me={me} onDate={setDate} />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  );
}

function TopBar({ me, houses, date, farmWide, onSignedOut }) {
  const nav = useNavigate();
  const { houseId } = useParams();

  async function signOut() {
    try { await api.logout(); } finally { onSignedOut(); }
  }

  const dot = (s) => (s === 'confirmed' || s === 'locked' ? 'dot done'
    : s === 'submitted' || s === 'draft' ? 'dot draft' : 'dot');

  return (
    <header className="topbar">
      <span className="brand">부여GP 일보</span>

      <nav className="house-tabs">
        {houses.map((h) => (
          <button key={h.houseId}
                  aria-current={String(h.houseId) === String(houseId)}
                  onClick={() => nav(`/report/${h.houseId}/${date}`)}>
            <span className={dot(h.status)} />{h.name}
          </button>
        ))}
      </nav>

      {/* 본사의 첫 화면. 탭 줄이 밀려도 이것만은 늘 보여야 한다 */}
      {farmWide && (
        <nav className="house-tabs" style={{ flex: '0 0 auto' }}>
          <button onClick={() => nav(`/status/${date}`)}
                  aria-current={!houseId}>제출 현황</button>
        </nav>
      )}

      <span className="spacer" />
      <span className="who">
        <b>{me.user.name}</b> · {me.user.roles.map(roleName).join('·')}
      </span>
      <button className="btn" onClick={signOut}>로그아웃</button>
    </header>
  );
}

function ReportRoute({ me, onDate, onChanged }) {
  const { houseId, date } = useParams();
  useEffect(() => { onDate(date); }, [date, onDate]);
  return <DailyReport key={`${houseId}-${date}`} me={me} houseId={houseId} date={date}
                      onChanged={onChanged} />;
}

function StatusRoute({ me, onDate }) {
  const { date } = useParams();
  useEffect(() => { onDate(date); }, [date, onDate]);
  return <HouseStatus me={me} date={date} />;
}

export function roleName(r) {
  return {
    team_lead: '팀장', farm_manager: '현장관리', hq_staff: '본사',
    hq_manager: '본사관리', auditor: '감사', admin: '관리자',
  }[r] ?? r;
}
