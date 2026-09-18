#!/bin/sh
# 야간 논리 백업 — HACCP 보존 3년 (§6.6)
# Supabase Pro 의 자동 백업·PITR 은 보존 7일이므로 이것이 장기 보관본이다.
set -eu

STAMP=$(date +%Y%m%d_%H%M%S)
OUT="/backups/buyeogp_${STAMP}.dump"
RETAIN="${BACKUP_RETENTION_DAYS:-1100}"

echo "[$(date -Iseconds)] 백업 시작 → ${OUT}"

pg_dump \
  -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_MIGRATE_USER}" -d "${DB_NAME}" \
  --format=custom --compress=9 --no-owner --no-acl \
  --schema=app --schema=sec \
  -f "${OUT}"

# 복원 가능성을 즉시 확인한다. 목록이 안 읽히면 그 백업은 없는 것과 같다.
pg_restore --list "${OUT}" > /dev/null
SIZE=$(wc -c < "${OUT}")
echo "[$(date -Iseconds)] 백업 완료 ${SIZE} bytes / 목록 판독 OK"

if [ "${SIZE}" -lt 100000 ]; then
  echo "경고: 백업 크기가 비정상적으로 작습니다 (${SIZE} bytes)" >&2
  exit 1
fi

# 오브젝트 스토리지로 사본 전송 (설정된 경우에만)
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "[$(date -Iseconds)] 원격 전송은 호스트의 aws/ncp CLI 로 수행하십시오: ${OUT}"
fi

# 보존기간 경과분 정리
find /backups -name 'buyeogp_*.dump' -type f -mtime "+${RETAIN}" -print -delete
