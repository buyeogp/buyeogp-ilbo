/**
 * 계정·담당 관리 — 설계문서 §6.1 / §6.3 / §6.7
 *
 * 배포한 뒤에는 개발자가 붙지 않는다. 담당이 수시로 바뀌는 현장이므로
 * 여기서 전부 끝나야 한다.
 *
 * 첫 화면을 **돈사 × 사람 표**로 둔 이유가 있다. 「누가 무엇을 맡고 있나」와
 * 「비어 있는 돈사가 있나」가 한눈에 보여야 한다 — 사고는 대개 아무도 담당이
 * 아닌 돈사에서 난다. 목록 두 개로 나누면 그게 안 보인다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, ROLE_LABEL, STATUS_USER, today } from '../api.js';

const FIELD_ROLES = ['team_lead', 'farm_manager', 'worker'];
const HQ_ROLES = ['hq_staff', 'hq_manager', 'auditor', 'admin'];

export function Admin({ me }) {
  const [tab, setTab] = useState('scope');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [secret, setSecret] = useState(null);   // 한 번만 보여 주는 비밀번호
  const [from, setFrom] = useState(today());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.adminOverview()); setErr(null); }
    catch (e) { setErr(e instanceof ApiError ? e.message : '불러오지 못했습니다.'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (fn, okMsg) => {
    if (busy) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fn();
      await load();
      setMsg(r?.message ?? okMsg ?? null);
      if (r?.warning) setErr(r.warning);
      return r;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '처리하지 못했습니다.');
    } finally { setBusy(false); }
  }, [busy, load]);

  if (err && !data) return <div className="center">{err}</div>;
  if (!data) return <div className="center">불러오는 중…</div>;

  return (
    <>
      <div className="house-banner">
        <h1>계정 관리</h1>
        <nav className="subtabs">
          <button aria-current={tab === 'scope'} onClick={() => setTab('scope')}>담당</button>
          <button aria-current={tab === 'user'} onClick={() => setTab('user')}>계정</button>
          <button aria-current={tab === 'log'} onClick={() => setTab('log')}>변경 이력</button>
        </nav>
        <span className="spacer" />
        {tab === 'scope' && (
          <label className="inline-field">
            <span>적용일</span>
            <input type="date" id="scope-from" value={from}
                   onChange={(e) => setFrom(e.target.value || today())} />
          </label>
        )}
      </div>

      {secret && <Secret info={secret} onClose={() => setSecret(null)} />}
      {msg && <div className="notes"><div className="note info"><span>{msg}</span></div></div>}
      {err && <div className="notes"><div className="note block"><span>{err}</span></div></div>}

      {tab === 'scope' && <ScopeGrid data={data} from={from} run={run} busy={busy} />}
      {tab === 'user' && (
        <Users data={data} me={me} run={run} busy={busy} setSecret={setSecret} />
      )}
      {tab === 'log' && <AuditLog />}
    </>
  );
}

/* ── 담당 : 돈사 × 사람 ─────────────────────────────────────────────── */
function ScopeGrid({ data, from, run, busy }) {
  const farmWideIds = useMemo(
    () => new Set(data.scopes.filter((s) => s.houseId == null && s.active).map((s) => s.userId)),
    [data.scopes]);

  // 돈사를 하나씩 맡는 사람만 세로로 세운다.
  // 전 돈사 담당(부장·본사)은 칸으로 표현할 수 없다 — 빈 열만 남아 오해를 부른다.
  const people = useMemo(
    () => data.users.filter((u) => u.status === 'active'
      && !farmWideIds.has(u.id)
      && u.roles.some((r) => r === 'team_lead' || r === 'farm_manager')),
    [data.users, farmWideIds]);

  // 칸 하나 = 그 사람이 그 돈사를 「앞으로도」 맡는지. 끝이 정해지지 않은 담당만 본다.
  // 적용일을 미래로 넣은 것도 여기 들어온다 — 누르자마자 칸에 보여야 넣은 줄 안다
  const open = useMemo(() => {
    const m = new Map();
    for (const s of data.scopes) {
      if (s.validTo) continue;                       // 끝난 · 끝날 예정인 담당은 칸에서 뺀다
      if (s.houseId == null) continue;               // 농장 전체는 칸으로 안 그린다
      m.set(`${s.userId}|${s.houseId}`, s);
    }
    return m;
  }, [data.scopes]);

  const farmWide = useMemo(
    () => data.users.filter((u) => u.status === 'active' && farmWideIds.has(u.id)),
    [data.users, farmWideIds]);

  // 넣기는 누르면 바로 된다 — 잘못 넣었으면 한 번 더 눌러 빼면 된다.
  // 빼기만 그 칸 바로 아래에서 한 번 묻는다. 빼면 그 팀장 화면에서 돈사가 사라지기 때문이다.
  const [ask, setAsk] = useState(null);       // 빼기를 묻고 있는 칸
  const [pending, setPending] = useState(null);
  const [flash, setFlash] = useState(null);   // 방금 바뀐 칸 — 잠깐 밝혀 둔다
  const [done, setDone] = useState(null);     // 방금 바뀐 칸 옆 알림 {key, add, user, house}

  useEffect(() => {
    if (!ask) return;
    // Esc 나 다른 곳을 누르면 닫는다 — 아무것도 바뀌지 않는다
    const esc = (e) => { if (e.key === 'Escape') setAsk(null); };
    const away = (e) => { if (!e.target.closest?.('td.pick.asking')) setAsk(null); };
    window.addEventListener('keydown', esc);
    window.addEventListener('mousedown', away);
    return () => {
      window.removeEventListener('keydown', esc);
      window.removeEventListener('mousedown', away);
    };
  }, [ask]);

  const change = async (user, house, has) => {
    const key = `${user.id}|${house.id}`;
    setAsk(null);
    setPending(key);
    const r = await run(() => (has ? api.scopeEnd(user.id, house.id, from)
                                   : api.scopeAdd(user.id, house.id, from)));
    setPending(null);
    if (r) {
      // 누른 자리에서 결과를 알려 준다. 모달은 닫기를 눌러야 해서 여러 칸을 넣을 때 흐름이 끊긴다 —
      // 저절로 사라지는 말풍선으로 둔다. 같은 내용은 위쪽 알림 줄에도 남는다
      setFlash(key);
      setDone({ key, add: !has, user: user.name, house: house.name });
      setTimeout(() => setFlash((f) => (f === key ? null : f)), 1800);
      setTimeout(() => setDone((d) => (d?.key === key ? null : d)), 2800);
    }
  };

  const press = (user, house) => {
    const key = `${user.id}|${house.id}`;
    if (open.has(key)) setAsk(ask === key ? null : key);
    else change(user, house, false);
  };

  const later = from > today();
  const md = (d) => d.slice(5).replace('-', '/');

  return (
    <>
      <p className="hint" style={{ marginBottom: 10 }}>
        빈 칸을 누르면 <b>바로 담당이 됩니다.</b> ● 칸을 누르면 그 자리에서 뺄지 묻습니다.
        {later
          ? <> 적용일이 <b>{from}</b> 이라 그날부터 바뀝니다 — 칸에 「{md(from)}부터」로 보입니다.</>
          : <> 적용일을 미래로 두면 그 날부터 바뀝니다 — 미리 넣어 두면 그날 기억하지 않아도 됩니다.</>}
      </p>

      <div className="grid-wrap fit">
        <table className="grid">
          <thead>
            <tr>
              <th className="rowhead">돈사</th>
              {people.map((p) => (
                <th key={p.id} className="person">
                  {p.name}
                  <i>{p.roles.map((r) => ROLE_LABEL[r]).join('·')}</i>
                </th>
              ))}
              <th style={{ width: 150 }}>담당 팀장</th>
            </tr>
          </thead>
          <tbody>
            {data.owners.map((o, oi) => {
              // 아래쪽 세 줄은 확인 창을 위로 띄운다 — 표 밖으로 나가면 잘린다
              const up = oi >= data.owners.length - 3;
              const house = data.houses.find((h) => h.id === o.houseId);
              return (
                <tr key={o.houseId} className={o.leadCount === 0 ? 'missing' : undefined}>
                  <td className="rowhead">{o.name}</td>
                  {people.map((p) => {
                    const key = `${p.id}|${o.houseId}`;
                    const s = open.get(key);
                    const soon = s && !s.active;              // 적용일이 아직 안 온 담당
                    const cls = ['chip', s && 'on', soon && 'soon',
                      pending === key && 'pending', flash === key && 'flash'].filter(Boolean).join(' ');
                    return (
                      <td key={p.id} className={ask === key ? 'pick asking' : 'pick'}>
                        <button type="button" className={cls}
                                disabled={busy}
                                aria-pressed={!!s}
                                title={s ? `${p.name} · ${o.name} — 누르면 뺄지 묻습니다`
                                         : `${p.name} · ${o.name} — 누르면 담당이 됩니다`}
                                onClick={() => press(p, house)}>
                          {pending === key ? '…' : s ? (soon ? '○' : '●') : ''}
                          {soon && <small>{md(s.validFrom)}부터</small>}
                        </button>
                        {done?.key === key && !ask && (
                          <div className={up ? 'cell-ask done up' : 'cell-ask done'} role="status">
                            <p>
                              <b>{done.house}</b> 이(가) <b>{done.user}</b> 님
                              {done.add ? ' 담당으로 들어갔습니다.' : ' 담당에서 빠졌습니다.'}
                            </p>
                            <p className="when">{later ? `${from} 부터` : '오늘부터'}</p>
                          </div>
                        )}
                        {ask === key && (
                          <div className={up ? 'cell-ask up' : 'cell-ask'} role="dialog"
                               aria-label={`${p.name} 님을 ${o.name} 담당에서 빼기`}>
                            <p><b>{p.name}</b> 님을 <b>{o.name}</b> 담당에서 뺄까요?</p>
                            <p className="when">
                              {later ? `${from} 부터 빠집니다` : '오늘부터 이 돈사 일보가 안 보입니다'}
                            </p>
                            <div className="acts">
                              <button type="button" className="btn small" autoFocus
                                      onClick={() => setAsk(null)}>그대로 둡니다</button>
                              <button type="button" className="btn small danger"
                                      onClick={() => change(p, house, true)}>뺍니다</button>
                            </div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className={o.leadCount === 0 ? 'readonly warn-cell' : 'readonly'}>
                    {o.leadCount === 0 ? '없음' : `${o.leadCount}명`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.owners.some((o) => o.leadCount === 0) && (
        <div className="notes" style={{ marginTop: 12 }}>
          <div className="note block">
            <span className="where">확인</span>
            <span>담당 팀장이 없는 돈사가 있습니다. 그 돈사는 <b>아무도 일보를 쓰지 않습니다.</b></span>
          </div>
        </div>
      )}

      {farmWide.length > 0 && (
        <p className="hint" style={{ marginTop: 10 }}>
          {farmWide.map((u) => u.name).join(', ')} 님은 <b>전 돈사</b> 담당이라 칸으로 그리지 않습니다.
        </p>
      )}
    </>
  );
}

/* ── 계정 ───────────────────────────────────────────────────────────── */
function Users({ data, me, run, busy, setSecret }) {
  const [adding, setAdding] = useState(false);
  const [ask, setAsk] = useState(null);      // 화면 안 확인 — 브라우저 대화상자를 쓰지 않는다
  const canRoles = data.can?.roles;

  return (
    <>
      <div className="actionbar" style={{ marginTop: 0, marginBottom: 10 }}>
        <span className="hint">
          계정은 지우지 않습니다. 그만둔 사람은 <b>중지</b>로 둡니다 — 지난 일보에 이름이 남아야 합니다.
        </span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setAdding(true)}>새 계정</button>
      </div>

      {adding && (
        <NewUser canRoles={canRoles} busy={busy}
                 onCancel={() => setAdding(false)}
                 onDone={async (body) => {
                   const r = await run(() => api.userCreate(body));
                   if (r?.password) { setSecret(r); setAdding(false); }
                 }} />
      )}

      <div className="grid-wrap fit">
        <table className="grid">
          <thead>
            <tr>
              <th className="rowhead">이름</th>
              <th style={{ width: 130 }}>아이디</th>
              <th style={{ width: 210 }}>등급</th>
              <th style={{ width: 90 }}>상태</th>
              <th style={{ width: 130 }}>마지막 로그인</th>
              <th>할 수 있는 일</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td className="rowhead">{u.name}</td>
                <td className="readonly">{u.loginId}</td>
                <td className="readonly text">
                  <RoleCell user={u} canRoles={canRoles} run={run} busy={busy} />
                </td>
                <td className="readonly">
                  <span className={u.status === 'active' ? 'chk ok' : 'chk bad'}>
                    {STATUS_USER[u.status] ?? u.status}
                  </span>
                </td>
                <td className="readonly">{u.lastLoginAt ? u.lastLoginAt.slice(0, 10) : '—'}</td>
                <td className="readonly text">
                  {ask?.id === u.id ? (
                    <span className="inline-confirm">
                      {ask.kind === 'pw' ? '비밀번호를 새로 만듭니다. 쓰던 것은 못 씁니다.'
                        : ask.next === 'active' ? '다시 쓸 수 있게 합니다.'
                        : '중지합니다. 지금 열린 화면도 끊깁니다.'}
                      <button className="btn small" onClick={() => setAsk(null)}>취소</button>
                      <button className="btn small primary" disabled={busy}
                              onClick={async () => {
                                const a = ask;
                                setAsk(null);
                                if (a.kind === 'pw') {
                                  const r = await run(() => api.userPassword(u.id));
                                  if (r?.password) setSecret(r);
                                } else {
                                  await run(() => api.userPatch(u.id, { status: a.next }),
                                    `${u.name} 님을 ${a.next === 'active' ? '다시 사용합니다' : '중지했습니다'}.`);
                                }
                              }}>예</button>
                    </span>
                  ) : (
                    <>
                      <button className="btn small" disabled={busy}
                              onClick={() => setAsk({ id: u.id, kind: 'pw' })}>
                        비밀번호 재발급
                      </button>
                      {u.id !== me.user.id && (
                        <button className="btn small" disabled={busy}
                                onClick={() => setAsk({ id: u.id, kind: 'status',
                                  next: u.status === 'active' ? 'suspended' : 'active' })}>
                          {u.status === 'active' ? '중지' : '다시 사용'}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!canRoles && (
        <p className="hint" style={{ marginTop: 10 }}>
          등급 변경은 본사만 합니다. 팀장이 스스로 확정 권한을 가지면
          자기 일보를 자기가 확정하게 되기 때문입니다.
        </p>
      )}
    </>
  );
}

/**
 * 등급 칸.
 *
 * 평소에는 글로만 보여 준다. 고칠 때만 알약이 나온다 —
 * 등급은 SoD-1 이 걸린 값이라 **한 번 잘못 누르면** 팀장이 확정 권한을 갖는다.
 * 고르고 나서 「적용」을 한 번 더 눌러야 바뀐다.
 */
function RoleCell({ user, canRoles, run, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.roles);

  const text = user.roles.map((r) => ROLE_LABEL[r]).join(' · ') || '없음';

  if (!canRoles) return <span>{text}</span>;

  if (!editing) {
    return (
      <span className="rolecell">
        <span className={user.roles.length ? '' : 'none'}>{text}</span>
        <button className="btn small" disabled={busy}
                onClick={() => { setDraft(user.roles); setEditing(true); }}>바꾸기</button>
      </span>
    );
  }

  const same = [...draft].sort().join(',') === [...user.roles].sort().join(',');
  return (
    <span className="rolecell edit">
      <span className="rolepick">
        {[...FIELD_ROLES, ...HQ_ROLES].map((r) => (
          <button key={r} type="button"
                  className={draft.includes(r) ? 'chip on sm' : 'chip sm'}
                  onClick={() => setDraft(draft.includes(r)
                    ? draft.filter((x) => x !== r) : [...draft, r])}>
            {ROLE_LABEL[r]}
          </button>
        ))}
      </span>
      <button className="btn small" onClick={() => setEditing(false)}>취소</button>
      <button className="btn small primary" disabled={busy || same}
              onClick={() => {
                setEditing(false);
                run(() => api.userRoles(user.id, draft),
                  `${user.name} 님의 등급을 ${draft.map((r) => ROLE_LABEL[r]).join('·') || '없음'} 으로 바꿨습니다.`);
              }}>적용</button>
    </span>
  );
}

function NewUser({ canRoles, busy, onCancel, onDone }) {
  const [loginId, setLoginId] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState(['team_lead']);
  const allowed = canRoles ? [...FIELD_ROLES, ...HQ_ROLES] : FIELD_ROLES;

  return (
    <div className="panel">
      <h3>새 계정</h3>
      <div className="row">
        <label className="inline-field">
          <span>아이디</span>
          <input id="new-login" value={loginId} placeholder="kim.cs"
                 onChange={(e) => setLoginId(e.target.value)} />
        </label>
        <label className="inline-field">
          <span>이름</span>
          <input id="new-name" value={name} placeholder="김철수"
                 onChange={(e) => setName(e.target.value)} />
        </label>
        <span className="rolepick">
          {allowed.map((r) => (
            <button key={r} type="button"
                    className={roles.includes(r) ? 'chip on sm' : 'chip sm'}
                    onClick={() => setRoles(roles.includes(r)
                      ? roles.filter((x) => x !== r) : [...roles, r])}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </span>
        <span className="spacer" />
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" disabled={busy || !loginId || !name}
                onClick={() => onDone({ loginId, name, roles })}>만들기</button>
      </div>
      <p className="hint">
        아이디는 영문 소문자·숫자로 3~30자. 비밀번호는 시스템이 만들어 <b>한 번만</b> 보여 줍니다.
        {!canRoles && ' 본사 등급은 본사가 지정합니다.'}
      </p>
    </div>
  );
}

/** 비밀번호는 여기서만 보인다. 서버에도 로그에도 남지 않는다. */
function Secret({ info, onClose }) {
  return (
    <div className="secret">
      <div>
        <p className="t">{info.name ?? info.loginId} 님의 임시 비밀번호</p>
        <p className="pw">{info.password}</p>
        <p className="hint">
          이 화면에서만 보입니다. 창을 닫으면 다시 볼 수 없고, 다시 만들어야 합니다.
          본인에게 전달하고 바로 바꾸게 하십시오.
        </p>
        {info.note && <p className="hint" style={{ color: 'var(--warn)' }}>{info.note}</p>}
      </div>
      <span className="spacer" />
      <button className="btn" onClick={() => navigator.clipboard?.writeText(info.password)}>복사</button>
      <button className="btn primary" onClick={onClose}>확인했습니다</button>
    </div>
  );
}

/* ── 변경 이력 ──────────────────────────────────────────────────────── */
function AuditLog() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.adminAudit(100).then((r) => setRows(r.entries)).catch(() => setRows([]));
  }, []);
  if (!rows) return <div className="center">불러오는 중…</div>;

  return (
    <>
      <p className="hint" style={{ marginBottom: 10 }}>
        계정·담당을 바꾼 기록입니다. <b>지울 수 없습니다</b> — HACCP 심사에서 요구하는 기록입니다.
      </p>
      <div className="grid-wrap fit">
        <table className="grid">
          <thead>
            <tr>
              <th className="rowhead" style={{ minWidth: 150 }}>언제</th>
              <th style={{ width: 120 }}>누가</th>
              <th>무엇을</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="rowhead">{String(e.at).slice(0, 16).replace('T', ' ')}</td>
                <td className="readonly">{e.actor}</td>
                <td className="readonly text">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
