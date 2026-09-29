/**
 * 비밀번호 해시 — node:crypto scrypt.
 *
 * bcrypt 는 네이티브 빌드가 필요해 컨테이너 이미지를 키우고 배포를 깨뜨린다.
 * scrypt 는 Node 에 들어 있고 OWASP 권고 대상이다.
 *
 * 저장 형식: scrypt$N$r$p$salt$hash  (전부 base64url)
 * 파라미터를 문자열에 박아 두면 나중에 비용을 올려도 옛 해시가 그대로 검증된다.
 */
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// N=2^15 은 약 100ms 수준. 로그인 빈도가 낮은 시스템이라 넉넉히 잡는다.
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 32 };
const b64 = (buf) => buf.toString('base64url');

export async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('비밀번호는 8자 이상이어야 합니다.');
  }
  const salt = randomBytes(16);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, PARAMS.keylen,
    { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 256 * 1024 * 1024 });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, b64(salt), b64(key)].join('$');
}

export async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64, 'base64url');
    const expect = Buffer.from(hashB64, 'base64url');
    const key = await scryptAsync(String(plain).normalize('NFKC'), salt, expect.length,
      { N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
    // 길이가 다르면 timingSafeEqual 이 던진다. 먼저 본다.
    return key.length === expect.length && timingSafeEqual(key, expect);
  } catch {
    return false;
  }
}

/** 초기 발급용. 읽어 주기 쉬운 난수 (혼동되는 글자 제외) */
export function generatePassword(len = 14) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * 본인이 정하는 비밀번호의 규칙. 현장에서 쓸 수 있을 만큼만 — 너무 까다로우면
 * 결국 종이에 적어 모니터에 붙인다.
 * @returns {string|null} 어긋나면 그 이유(화면에 그대로 보인다), 괜찮으면 null
 */
const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000',
  'password', 'password1', 'qwer1234', 'qwerty12', '1q2w3e4r', '1q2w3e4r5t', 'asdf1234',
  'abcd1234', 'a1234567', 'zxcv1234', '1234qwer', 'iloveyou', 'buyeogp1', 'buyeogp123',
]);
export function passwordProblem(plain, loginId) {
  const p = String(plain ?? '');
  if (p.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  if (p.length > 64) return '비밀번호는 64자 이하로 해 주십시오.';
  if (/^\d+$/.test(p)) return '숫자만으로는 만들 수 없습니다. 영문자를 섞어 주십시오.';
  if (/(.)\1{3,}/.test(p)) return '같은 글자를 4번 넘게 잇달아 쓸 수 없습니다.';
  const lower = p.toLowerCase();
  const id = String(loginId ?? '').toLowerCase();
  if (id && (lower.includes(id) || id.includes(lower))) return '아이디가 들어간 비밀번호는 쓸 수 없습니다.';
  if (COMMON.has(lower)) return '너무 흔한 비밀번호입니다. 다른 것으로 정해 주십시오.';
  return null;
}
