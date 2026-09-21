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

async function call(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', '서버에 닿지 않습니다. 잠시 뒤에 다시 해 주십시오.');
  }

  let data = null;
  try { data = await res.json(); } catch { /* 본문이 없을 수 있다 */ }

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

  status: (date) => call('GET', `/reports/status?date=${date}`),
  report: (houseId, date) => call('GET', `/reports/${houseId}/${date}`),
  open: (houseId, date) => call('POST', `/reports/${houseId}/${date}/open`),
  saveRows: (reportId, rows, noteText) =>
    call('PUT', `/reports/${reportId}/rows`, { rows, noteText }),
  submit: (reportId) => call('POST', `/reports/${reportId}/submit`),
  confirm: (reportId) => call('POST', `/reports/${reportId}/confirm`),
  unconfirm: (reportId) => call('POST', `/reports/${reportId}/unconfirm`),
};

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
