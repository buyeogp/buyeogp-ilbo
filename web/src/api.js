/**
 * API 호출 한 곳.
 *
 * 서버가 이미 한국어로 이유를 말해 준다(`{error, message}`). 화면이 그 말을
 * 다시 지어내면 두 곳의 기준이 갈린다 — 그대로 보여 준다.
 */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * 세션 만료 — 매 응답의 X-Session-Exp 를 기억해 두고, 401 이 오면 바로 알린다.
 * 화면(SessionGuard)이 이걸 보고 2분 전 안내 · 즉시 로그인 화면 전환을 한다.
 */
const sessionListeners = new Set();
export const session = {
  exp: null,                       // Date — 이 시각이 지나면 서버가 로그아웃시킨다
  on(fn) { sessionListeners.add(fn); return () => sessionListeners.delete(fn); },
};
const sessionEmit = (type) => { for (const fn of sessionListeners) fn(type); };

async function call(method, path, body) {
  // 사진은 파일 그대로 보낸다 (Blob). 나머지는 JSON
  const raw = body instanceof Blob;
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined
        : { 'content-type': raw ? (body.type || 'image/jpeg') : 'application/json' },
      body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
    });
  } catch {
    throw new ApiError(0, 'offline', '서버에 닿지 않습니다. 잠시 뒤에 다시 해 주십시오.');
  }

  const exp = res.headers.get('x-session-exp');
  if (exp) { session.exp = new Date(exp); sessionEmit('exp'); }

  let data = null;
  try { data = await res.json(); } catch { /* 본문이 없을 수 있다 */ }

  // 로그인이 끝났다 — 다음 동작을 기다리지 않고 바로 로그인 화면으로 (로그인·me 요청 자체는 제외)
  if (res.status === 401 && data?.error === 'unauthenticated' && path !== '/auth/me') {
    session.exp = null;
    sessionEmit('expired');
  }

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'unknown',
      data?.message ?? '처리 중 문제가 생겼습니다.');
  }
  return data;
}

export const api = {
  login: (loginId, password) => call('POST', '/auth/login', { loginId, password }),
  logout: () => call('POST', '/auth/logout'),
  me: () => call('GET', '/auth/me'),
  sessionExp: () => call('GET', '/auth/session'),
  changePassword: (current, next) => call('POST', '/auth/password', { current, next }),
  sessions: () => call('GET', '/auth/sessions'),
  revokeOthers: () => call('POST', '/auth/sessions/revoke-others'),

  status: (date) => call('GET', `/reports/status?date=${date}`),
  report: (houseId, date) => call('GET', `/reports/${houseId}/${date}`),
  open: (houseId, date) => call('POST', `/reports/${houseId}/${date}/open`),
  saveRows: (reportId, rows, noteText, bulkZero) =>
    call('PUT', `/reports/${reportId}/rows`, { rows, noteText, bulkZero }),
  submit: (reportId) => call('POST', `/reports/${reportId}/submit`),
  submitMany: (reportIds) => call('POST', '/reports/submit-many', { reportIds }),
  confirm: (reportId, selfConfirm = false) =>
    call('POST', `/reports/${reportId}/confirm`, selfConfirm ? { selfConfirm: true } : undefined),
  unconfirm: (reportId) => call('POST', `/reports/${reportId}/unconfirm`),
  withdraw: (reportId) => call('POST', `/reports/${reportId}/withdraw`),
  sendBack: (reportId, reason) => call('POST', `/reports/${reportId}/return`, { reason }),

  // 폐사·도태 (§4.7) — 일보의 폐사·도태 칸은 여기서만 채워진다
  deaths: (reportId) => call('GET', `/reports/${reportId}/deaths`),
  deathAdd: (reportId, body) => call('POST', `/reports/${reportId}/deaths`, body),
  deathDel: (reportId, kind, id) => call('DELETE', `/reports/${reportId}/deaths/${kind}/${id}`),
  photoUp: (reportId, blob) => call('POST', `/reports/${reportId}/deaths/photo`, blob),
  photoAttach: (reportId, id, photoKey) =>
    call('POST', `/reports/${reportId}/deaths/mortality/${id}/photo`, { photoKey }),
  deathLog: (date, houseId) =>
    call('GET', `/deaths?date=${date}${houseId ? `&houseId=${houseId}` : ''}`),
  photoSrc: (reportId, id) => `/api/reports/${reportId}/deaths/mortality/${id}/photo`,

  // 계정·담당 관리 (§6.1 / §6.3)
  adminOverview: () => call('GET', '/admin/overview'),
  adminAudit: (limit = 60) => call('GET', `/admin/audit?limit=${limit}`),
  scopeAdd: (userId, houseId, from) => call('POST', '/admin/scopes', { userId, houseId, from }),
  scopeEnd: (userId, houseId, from) => call('POST', '/admin/scopes/end', { userId, houseId, from }),
  userCreate: (body) => call('POST', '/admin/users', body),
  userPatch: (id, body) => call('PATCH', `/admin/users/${id}`, body),
  userPassword: (id) => call('POST', `/admin/users/${id}/password`),
  userRoles: (id, roles) => call('POST', `/admin/users/${id}/roles`, { roles }),
};

export const ROLE_LABEL = {
  worker: '작업자', team_lead: '팀장', farm_manager: '현장관리',
  hq_staff: '본사', hq_manager: '본사관리', auditor: '감사', admin: '관리자',
};

export const STATUS_USER = { active: '사용 중', suspended: '중지', left: '퇴사' };

/** 오늘. toISOString 은 UTC 라 한국 시각으로 하루가 밀린다 — 현지 날짜를 쓴다. */
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}. ${m}. ${d}. (${WEEK[new Date(y, m - 1, d).getDay()]})`;
}

export const STATUS_LABEL = {
  draft: '작성 중',
  submitted: '제출됨',
  confirmed: '확정',
  locked: '마감',
  미시작: '미시작',
};
