/**
 * 화면 껍데기.
 *
 * 권한으로 메뉴를 숨기지만 그건 UX 일 뿐이다 — 막는 것은 서버다 (§6.7).
 * 그래서 여기서는 「보여 줄 것을 고르는」 일만 한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, today } from './api.js';
import { setObserveUser } from './observe.js';
import { Login } from './pages/Login.jsx';
import { DailyReport } from './pages/DailyReport.jsx';
import { HouseStatus } from './pages/HouseStatus.jsx';
import { Admin } from './pages/Admin.jsx';
import { Help } from './pages/Help.jsx';
import { TestGuide } from './pages/TestGuide.jsx';
import { Toasts } from './components/Toasts.jsx';
import { ChangePassword } from './pages/ChangePassword.jsx';
import { AccountMenu, Sessions } from './components/AccountMenu.jsx';
import * as live from './live.js';

const FARM_WIDE = ['farm_manager', 'hq_staff', 'hq_manager', 'auditor'];
const HQ = ['hq_staff', 'hq_manager'];

export function App() {
  const [me, setMe] = useState(undefined);   // undefined = 확인 중, null = 미로그인

  const refresh = useCallback(
    () => api.me().then(setMe).catch(() => setMe(null)), []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setObserveUser(me?.user); }, [me]);

  if (me === undefined) return <div className="center">불러오는 중…</div>;
  if (me === null) return <Login onDone={refresh} />;
  // 관리 화면이 준 비밀번호 그대로면 새 비밀번호부터 (027). 서버도 다른 요청을 막는다
  if (me.user.mustChangePassword) {
    return <ChangePassword me={me} forced onDone={refresh}
                           onSignOut={async () => { try { await api.logout(); } finally { setMe(null); } }} />;
  }
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

  // 실시간 알림 — 로그인해 있는 동안 연결 하나. 위쪽 돈사 탭의 점(상태)도 따라 바뀐다
  useEffect(() => { live.start(); return () => live.stop(); }, []);
  useEffect(() => live.on((type, ev) => {
    if (type === 'resync' || (type === 'change' && ev.date === date)) loadStatus(date);
    if (type === 'bye') onSignedOut();
  }), [date, loadStatus, onSignedOut]);

  const home = houses[0]
    ? `/report/${houses[0].houseId}/${date}`
    : (myHouses[0] ? `/report/${myHouses[0].houseId}/${date}` : `/status/${date}`);

  return (
    <div className="shell">
      <TopBar me={me} houses={houses} date={date} farmWide={farmWide}
              onSignedOut={() => { live.stop(); onSignedOut(); }} />
      <Toasts me={me} farmWide={farmWide} />
      <OtherLogin />
      <main>
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/report/:houseId/:date"
                 element={<ReportRoute me={me} onDate={setDate}
                                       onChanged={() => loadStatus(date)} />} />
          <Route path="/status/:date"
                 element={<StatusRoute me={me} onDate={setDate} />} />
          <Route path="/admin" element={<Admin me={me} />} />
          <Route path="/help" element={<Help me={me} />} />
          {/* 발주처 시험 기간 전용 — 정식 가동하면 이 줄과 위쪽 단추를 내린다 */}
          <Route path="/test" element={<TestGuide me={me} />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </div>
  );
}

function TopBar({ me, houses, date, farmWide, onSignedOut }) {
  const nav = useNavigate();
  const { houseId } = useParams();
  // 「관리자」는 직책이 아니라 부여되는 권한이다 — 팀장이 함께 가질 수 있다
  const canAdmin = me.user.roles.some((r) => r === 'admin' || HQ.includes(r));

  const loc = useLocation();

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
      <nav className="house-tabs" style={{ flex: '0 0 auto' }}>
        {canAdmin && (
          <button onClick={() => nav('/admin')}
                  aria-current={loc.pathname === '/admin'}>계정 관리</button>
        )}
        <button onClick={() => nav('/test')}
                aria-current={loc.pathname === '/test'}>테스트 안내</button>
        <button onClick={() => nav('/help')}
                aria-current={loc.pathname === '/help'}>설명서</button>
      </nav>
      {/* 내 이름 — 비밀번호 바꾸기 · 열려 있는 로그인 */}
      <AccountMenu me={me}
                   label={<><b>{me.user.name}</b> · {me.user.roles.map(roleName).join('·')}</>} />
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

/**
 * 로그인했을 때 같은 계정이 다른 곳에도 열려 있었다 — 한 번 알린다 (§6.4).
 * 막지는 않는다. 내가 아니면 목록을 열어 끊는다.
 */
function OtherLogin() {
  const [info] = useState(() => {
    try {
      const v = JSON.parse(sessionStorage.getItem('otherLogin') ?? 'null');
      sessionStorage.removeItem('otherLogin');
      return v;
    } catch { return null; }
  });
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  if (!info || hidden) return open ? <Sessions onClose={() => setOpen(false)} /> : null;
  const at = info.latest?.lastSeenAt
    ? new Date(info.latest.lastSeenAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className="notes other-login">
      <div className="note warn">
        <span className="where">다른 곳</span>
        <span>
          이 계정이 <b>다른 곳 {info.n}곳</b>에서도 로그인되어 있습니다
          {info.latest ? ` (가장 최근: ${info.latest.device}${at ? `, ${at}` : ''})` : ''}.
          {' '}내가 쓰는 다른 기기(휴대폰 등)가 아니면 끊고 비밀번호를 바꾸십시오. 계정은 같이 쓰지 않습니다.
        </span>
        <span className="spacer" />
        <button className="btn small" onClick={() => { setOpen(true); setHidden(true); }}>열린 로그인 보기</button>
        <button className="btn small" onClick={() => setHidden(true)}>닫기</button>
      </div>
      {open && <Sessions onClose={() => setOpen(false)} />}
    </div>
  );
}
