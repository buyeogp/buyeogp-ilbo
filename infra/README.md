# 인프라 구성 · 운영 절차

부여GP 일보 시스템의 배포 환경이다. 설계문서 §7.1 의 구성을
Supabase(서울) + 앱 서버 1대로 구현한다.

```
[현장사무실 PC 3대]  Chrome
        │ HTTPS
[Cloudflare Pages]   프론트 정적 호스팅 (React + 데이터 그리드)
        │ /api
[앱 서버 1대 · 서울]  Caddy → API (검증 룰 · 권한 · PDF · SSE)
        │ 5432 direct
[Supabase · 서울]     PostgreSQL 17 · Storage · pg_cron  (개발 Free / 운영 Pro)
```

| 부품 | 역할 | 개발 | 운영 |
|---|---|---:|---:|
| Supabase (ap-northeast-2) | DB · 파일 · 백업 | $0 (Free) | $25 (Pro) |
| 앱 서버 VM 2GB (서울) | API · **PDF 생성** · SSE | $12 | $12 |
| Cloudflare Pages / DNS | 프론트 · 도메인 | $0 | $0 |
| Sentry · NCP Mailer · 스테이징 Supabase | 관측 · 메일 · 검증 | $0 | $0 |
| | | **$12** | **약 $37** |

**개발 단계는 Supabase Free 로 시작한다.** 이 시스템이 쓰는 기능 중 Pro 전용은 없다 —
`CREATE ROLE` 역할 분리, `btree_gist`, RLS, Storage, `pg_cron` 모두 Free 에서 동작하고
데이터도 과거 4주치가 수십 MB 라 500MB 한도에 한참 못 미친다.
Free 에 없는 것은 자동 백업·PITR 과 7일 무활동 시 일시정지 둘뿐인데,
스키마는 `db/*.sql`, 과거 데이터는 `db/migration/*.csv` 에 있어 날아가도 10분이면 복구된다.
플랜은 나중에 올려도 같은 프로젝트가 그대로 Pro 가 되고 연결 문자열도 바뀌지 않는다.

**앱 서버가 필요한 이유** — 설계문서 §6.5 가 요구하는 HACCP 일보 PDF 는
Puppeteer(Chromium)로 굽는다. Cloudflare Workers·Supabase Edge Functions(Deno)
에서는 돌지 않는다. PDF 를 브라우저에서 만들면 `submission_signature.content_hash`
(출력물 == 시스템 데이터 증명)가 깨져 HACCP 대응이 무너진다.

---

## 앱 서버 (Lightsail) — 2026-09-28 개설

| | |
|---|---|
| 인스턴스 | `buyeogp-api` · Ubuntu 24.04 LTS · 2GB / 2 vCPU / 60GB · 월 $12 |
| 지역 | **서울** ap-northeast-2a |
| 고정 IP | **43.202.152.109** (`buyeogp-ip`) |
| 방화벽 | 22 SSH · 80 HTTP · 443 HTTPS |
| AWS 계정 | 프로젝트 「Sky is the Limit」 (061534657492) · 관리 계정 buyeogp (939005125427) |

### 새 AWS 계정은 서울을 못 쓴다 — 개설하며 막힌 곳

2025년 이후 신규 가입은 「간편 모드」로 시작하고, **주소가 한국이면 지역이
시드니(ap-southeast-2)로 고정**된다. 서울에서 Lightsail 을 열면
`lightsail:GetRegions 액세스 거부` 가 난다. 시드니에 서버를 두면 서울의
Supabase 와 왕복마다 0.13초가 붙어 일보 한 번 여는 데 2~3초가 걸린다.

푼 순서:

1. **Paid plan 으로 업그레이드** — Free plan 은 크레딧 소진·6개월 뒤 계정이 닫힌다
2. **고급 기능 활성화** (settings.aws.com → 프로젝트 → 작업) — **되돌릴 수 없다.**
   지출 한도(자동 정지)가 사라지고 Budgets 알림으로 대신한다
3. **지역 제한 SCP 수정** — Organizations → 서비스 제어 정책 →
   `AdvancedModeRegionRestrictionSecurityControlPolicy` → `RegionFloor` 의
   `aws:RequestedRegion` 목록에 `"ap-northeast-2"` 추가.
   편집기가 35번 줄 `builderid:*` 를 오류로 표시하지만 AWS 원래 내용이다 — 무시하고 저장
4. **표시 지역 설정** — 콘솔 ⚙ → 모든 사용자 설정 보기 → **「계정 설정」 탭** →
   표시되는 리전에 서울 추가. 이걸 안 하면 권한이 있어도 서울 화면에
   「Region restricted」 창이 떠서 쓸 수 없다. **서울 화면에서는 고칠 수 없으니
   시드니 주소로 들어가서** 고친다

스테이징이나 두 번째 서버를 만들 때도 같은 계정이면 이미 풀려 있다.
**새 계정을 만들면 전부 다시 해야 한다.**

## 도메인

| | |
|---|---|
| 도메인 | **piggp.com** (hosting.kr) |
| 일보 주소 | `ilbo.piggp.com` |
| 등록 명의 | 김영빈 실장 **개인** |

`APP_DOMAIN` 이 이 이름이다. Caddy 가 이 이름으로 Let's Encrypt 인증서를 받으므로
**실제 소유한 도메인이어야** 한다. 개발 PC 에서는 Caddy 를 띄우지 않아 값이 쓰이지 않는다.

hosting.kr 에서 샀으므로 네임서버가 아직 hosting.kr 을 가리킨다.
Cloudflare 로 옮겨야 Pages(6단계)를 붙일 수 있다 — 런북 5단계.

**명의가 개인이다.** 회사 시스템이 이 도메인 하나에 매달리는데 등록자가 개인이면,
담당자가 바뀔 때 접속 주소를 잃는다. 갱신을 놓쳐도 같은 일이 난다.
운영 전환 전에 법인 명의로 옮기거나, 최소한 갱신 알림이 회사 메일로 가게 해 둔다.

## 1. Supabase 프로젝트

1. 새 프로젝트 · 리전 **Northeast Asia (Seoul)** · 플랜 **Free** (운영 전환 때 Pro 로 올린다)
2. Settings → Database → Connection string → **Direct connection (5432)** 복사
   - 풀러(6543)는 쓰지 않는다. 동시 접속이 7명 수준이라 불필요하고,
     직접 연결이어야 `buyeogp_app` 역할 분리(SoD-3)가 유지된다
3. Settings → Database → **Point in Time Recovery** — Pro 전용이라 개발 중에는 건너뛴다

## 2. 스키마 적용

```bash
cd infra
cp .env.example .env      # DB_HOST / DB_MIGRATE_PASSWORD 채우기
docker compose --profile tools run --rm migrate
```

`000_run_all.sql` 이 `BEGIN`/`COMMIT` 으로 감싸여 있어 도중에 실패하면 통째로
롤백된다. 성공하면 마지막에 돈방·집계행 적재 건수가 NOTICE 로 찍힌다.

> 마이그레이션은 **소유자(`postgres`)로** 돌린다. PostgreSQL 은 테이블 소유자에게
> RLS 를 적용하지 않으므로 시드(015·016)가 통과한다. 운영 트래픽은 소유자가 아닌
> `buyeogp_api` 로 들어오므로 RLS 가 정상 작동한다.

## 3. 접속 계정 만들기

스키마는 권한만 담은 그룹 역할 셋을 만든다 — `buyeogp_app` · `buyeogp_admin` ·
`buyeogp_auditor`. 실제 로그인 계정은 여기에 소속시켜 **따로** 만든다.
비밀번호가 저장소에 들어가지 않게 하기 위해서다.

```sql
-- Supabase SQL Editor 또는 docker compose --profile tools run --rm psql
CREATE ROLE buyeogp_api     LOGIN PASSWORD '<생성한 난수>' IN ROLE buyeogp_app;
CREATE ROLE buyeogp_auditor_login LOGIN PASSWORD '<난수>'  IN ROLE buyeogp_auditor;

-- 접속 시 스키마 경로 고정 (그룹 역할에 건 설정은 상속되지 않는다)
ALTER ROLE buyeogp_api           SET search_path = app, sec, extensions, public;
ALTER ROLE buyeogp_auditor_login SET search_path = app, sec, extensions, public;
```

`buyeogp_admin` 은 계정·권한 관리 전용이며 `app` 스키마에 GRANT 가 없다 —
설계문서 SoD-3(「admin 은 업무데이터 접근 불가」)이 DB 권한 수준에서 강제된다.

### 신원 전달

API 는 매 트랜잭션마다 현재 사용자를 알려줘야 한다. RLS 전체가 이 값 하나에
걸려 있다.

```sql
BEGIN;
SET LOCAL app.user_id = '12';    -- sec.app_user.id
-- ... 업무 쿼리 ...
COMMIT;
```

`SET LOCAL` 이므로 트랜잭션이 끝나면 사라진다. 커넥션 풀에서 값이 새지 않는다.

## 4. Storage 버킷

Supabase Storage 에 **비공개** 버킷 3개를 만든다.

| 버킷 | 용도 | 근거 |
|---|---|---|
| `mortality-photo` | 폐사 사진 | V10 — 사진 없이 폐사 등록 불가 |
| `medicine-invoice` | 거래명세표 스캔 | §4.9.3 `medicine_receipt.scan_url` |
| `daily-report-pdf` | 일보 PDF | §6.5 HACCP 3년 보관 |

공개 버킷으로 만들지 않는다. API 가 서명 URL 로만 내준다.

## 5. 앱 서버

서울 리전 VM 1대(2GB 이상). Lightsail·NCP 어느 쪽이든 같다.
2GB 를 권하는 이유는 Puppeteer 가 1GB 가까이 쓰기 때문이다.

```bash
# Docker 설치 후
git clone <private-repo> /opt/buyeogp && cd /opt/buyeogp/infra
cp .env.example .env && vi .env
docker compose up -d
```

`api` 서비스의 `shm_size: 512mb` 는 지우지 말 것 — 기본 64MB 로는 대량 PDF
생성에서 Chromium 이 죽는다.

## 6. 백업 — 여기가 가장 중요하다

**Free 에는 자동 백업이 아예 없고, Pro 로 올려도 PITR 보존은 7일이다.
설계문서 §6.6 의 「보존 3년」을 어느 쪽도 덮지 못한다.** 야간 논리 백업을 별도로 남겨야 한다.

개발 중에는 이 cron 을 걸지 않아도 된다 — 스키마와 과거 데이터가 저장소에 있어
재생성이 가능하기 때문이다. **운영 전환 시점에는 반드시 건다.**

```bash
# 호스트 crontab — 매일 03:10
10 3 * * * cd /opt/buyeogp/infra && docker compose --profile tools run --rm backup >> /var/log/buyeogp-backup.log 2>&1
```

`backup.sh` 는 덤프 후 `pg_restore --list` 로 **읽히는지까지 확인**하고 크기가
비정상이면 실패 처리한다. 백업이 도는 줄 알았는데 안 돌았다는 사고가 가장 흔하다.

> **복구 훈련을 분기 1회 한다.** 스테이징 프로젝트에 최신 덤프를 복원해
> 일보 한 건을 조회해 보는 것으로 충분하다. 해 보지 않은 백업은 백업이 아니다.

## 7. Cloudflare

- DNS: `ilbo.<도메인>` A 레코드 → 앱 서버 고정 IP (**프록시 끄기**).
  Caddy 가 Let's Encrypt 인증서를 직접 받아야 하므로 회색 구름으로 둔다
- Pages: 프론트 저장소 연결, 빌드 산출물 배포
- API 호출은 `https://ilbo.<도메인>/api/*` 로 같은 오리진에 붙인다 (CORS 불필요)

## 8. 스테이징

병행운영 4주(설계문서 M4) 동안 실데이터와 대조할 환경이다.

- Supabase 무료 프로젝트 1개 (서울). **무료는 조직당 2개까지**라 개발 1 + 스테이징 1 이면 한도에 맞는다.
  운영만 Pro 로 올리고 나머지를 Free 로 남기려면 조직을 나눠야 한다 — 플랜이 프로젝트가 아니라 조직 단위다
- 앱 서버는 **같은 VM 에 컨테이너만 분리** (`COMPOSE_PROJECT_NAME=buyeogp_stg`, 다른 포트)
- 비용 0

무료 티어는 7일 무활동 시 일시정지되지만 병행운영 중에는 매일 쓰므로 해당 없다.
용량 500MB 는 4주치(감사로그 포함 약 15MB 예상)에 충분하다.

## 9. 로컬 스키마 검증

DB 를 건드리지 않고 스키마가 실제로 올라가는지만 보고 싶을 때.

```bash
docker compose --profile localdb up -d localdb
docker compose --profile tools run --rm \
  -e DB_HOST=localdb -e DB_MIGRATE_USER=postgres \
  -e DB_MIGRATE_PASSWORD=localdev -e DB_NAME=buyeogp migrate
```

끝나면 `docker compose --profile localdb down -v` 로 지운다.

---

## 아직 없는 것

| # | 항목 | 비고 |
|---|---|---|
| 1 | `../api` 백엔드 코드 | `docker-compose.yml` 의 `api` 서비스가 참조하는 빌드 컨텍스트. 아직 비어 있다 |
| 2 | 프론트 저장소 | Cloudflare Pages 연결 대상 |
| 3 | 18:00 미제출 알림 작업 | Supabase `pg_cron` + 기존 `v_submission_status` 로 구현 가능 |
| 4 | 웹 푸시 구독 테이블 | 알림 1단계. 스키마에 아직 없다 |

3번은 이미 만들어 둔 뷰를 호출하기만 하면 되므로 짧다.

```sql
-- 참고: pg_cron 등록 예 (아직 적용하지 않았다)
SELECT cron.schedule('unsubmitted-18h', '0 9 * * *', $$
  INSERT INTO app.exception_queue
    (farm_id, event_date, house_id, severity, rule_code, message)
  SELECT farm_id, report_date, house_id, 'warn', 'L4-UNSUBMITTED',
         house_name || ' 일보 미제출 (마감 30분 전)'
    FROM app.v_submission_status
   WHERE status IN ('미시작','draft')
  ON CONFLICT DO NOTHING;
$$);
-- 09:00 UTC = 18:00 KST. pg_cron 은 UTC 로 돈다
```
