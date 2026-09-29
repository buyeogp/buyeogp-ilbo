/**
 * 폐사 사진 저장 — §4.7 V10
 *
 * 운영: Supabase Storage 비공개 버킷 `mortality-photo` 에 S3 방식으로 넣는다.
 *       현장에는 URL 을 주지 않고 API 가 대신 읽어 보낸다 (권한 검사를 거친다).
 * 개발: S3 키가 없으면 api/out/photos 에 둔다. 운영에서 키가 없으면 올리기를 막는다 —
 *       컨테이너 안에 두면 다시 빌드할 때 사진이 사라진다.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config, ROOT } from './config.js';

const P = config.photos;
const LOCAL = path.join(ROOT, 'api', 'out', 'photos');

export const TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
};

let s3 = null;
const client = () => (s3 ??= new S3Client({
  endpoint: P.endpoint,
  region: P.region,
  forcePathStyle: true,
  credentials: { accessKeyId: P.keyId, secretAccessKey: P.secret },
}));

/** 올릴 수 있나. 운영인데 키가 없으면 false — 화면은 「사진 없음 사유」로 안내한다 */
export const canStore = () => P.configured || config.env !== 'production';

/**
 * @param {Buffer} body
 * @param {string} type  image/jpeg …
 * @param {string} prefix  '농장/돈사/날짜'
 * @returns {Promise<string>} 저장 키 — mortality.photo_url 에 이 값을 둔다
 */
export async function putPhoto(body, type, prefix) {
  const key = `${prefix}/${randomUUID()}.${TYPES[type]}`;
  if (P.configured) {
    await client().send(new PutObjectCommand({
      Bucket: P.bucket, Key: key, Body: body, ContentType: type,
    }));
  } else {
    const file = path.join(LOCAL, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
  return key;
}

/** @returns {Promise<{body: Buffer|ReadableStream, type: string}>} */
export async function getPhoto(key) {
  const ext = key.split('.').pop();
  const type = Object.keys(TYPES).find((t) => TYPES[t] === ext) ?? 'application/octet-stream';
  if (P.configured) {
    const r = await client().send(new GetObjectCommand({ Bucket: P.bucket, Key: key }));
    return { body: r.Body, type: r.ContentType ?? type };
  }
  return { body: await readFile(path.join(LOCAL, key)), type };
}
