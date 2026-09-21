# API 서버

부여GP 돈사 일보 시스템의 백엔드. 설계문서 §7.1 이 정한 역할은 넷이다 —
**검증 룰 엔진 · 권한 · 일보 PDF 생성 · 실시간 예외 큐(SSE)**.

**인증·권한·일보 입력·제출·확정과 PDF 생성**이 들어 있다.
실제 Supabase 에 붙여 HTTP 로 두드려 확인했다 (`npm run smoke`, 27건 통과).
남은 것은 이동 1:N 대사, 예외 큐 SSE, 폐사·약품 등록이다.

```
api/
  src/
    config.js          infra/.env 읽기. 값이 없으면 기동 시 죽는다
    server.js          기동
  src/auth/
    password.js        scrypt (네이티브 의존성 없음)
    session.js         DB 세션. 현장 15분 / 본사 30분
  src/http/
    app.js             조립
    middleware.js      권한 전건 검사 + 오류 변환
    routes/auth.js     로그인·로그아웃·/me
    routes/reports.js  일보 조회·저장·제출·확정
    smoke.js           실제 HTTP 로 두드리는 확인 27건
  src/db/
    migrate.js         스키마 적용 (psql 없이 Node 로)
    verify.js          동작 검증 43건
    load-m3.js         과거 자료 적재
    setup-app-role.js  앱 계정 생성 + RLS 실제 적용 확인
  src/pdf/
    layout.js      일보 HTML 생성 — 3종 레이아웃
    styles.js      인쇄용 CSS (A4 가로, mm 단위)
    render.js      Puppeteer 렌더러 + content_hash
    render-all.js  3종 일괄 출력 + PNG 미리보기
    sample.js      판독한 실제 일보에서 샘플 데이터 생성
  out/             출력물 (git 제외)
```

## DB 도구

이 장비에 psql 도 Docker 도 없어서 Node 로 만들었다. 하는 일은 psql 과 같고,
백엔드가 어차피 `pg` 를 쓰므로 버리는 작업이 아니다.

```bash
npm run dev            # 개발 서버 (--watch)
npm run smoke          # API 실동작 확인 27건 — 서버를 띄워 실제로 두드린다
npm run seed:users     # 조직도 기준 계정 8개 발급 (비밀번호는 화면에만)

npm run migrate        # db/001~020 을 하나의 트랜잭션으로 적용
npm run migrate:reset  # 스키마를 지우고 다시 (개발 전용, 데이터 있으면 --force 필요)
npm run verify         # 트리거·생성열·RLS 가 실제로 동작하는지 43건
npm run load:m3        # 과거 4주치 3,681행 적재 + 엑셀 대조
npm run setup:role     # buyeogp_api 생성, RLS 가 정말 걸리는지 확인
```

접속 정보는 `infra/.env` 에서 읽는다. Supabase 직접 연결은 IPv6 전용이라
**Session pooler(IPv4)** 를 쓴다 — Transaction pooler 와 달리 세션 상태를 유지해서
`SET LOCAL app.user_id` 와 커스텀 역할이 그대로 동작한다.

## 권한을 두 겹으로 두는 이유

설계문서 §6.7 은 「권한 검사는 서버 API 전건 검사. 프런트 메뉴 숨김은 UX 일 뿐」
이라고 못박는다. 그래서 미들웨어가 전건을 본다. 그 아래 RLS 정책 74개가 또 본다.

겹쳐 두는 이유는 **실패하는 방식이 다르기** 때문이다.

| | 막는 방식 | 쓸모 |
|---|---|---|
| 미들웨어 | 403 + 이유 | 「담당 돈사가 아닙니다」 — 사람이 고칠 수 있다 |
| RLS | 조용히 0행 | 코드에 구멍이 나도 데이터가 새지 않는다 |

실제로 개발 중에 RLS 가 버그를 잡았다. 세션 해석을 신원 없는 트랜잭션으로
돌렸더니 `/me` 의 돈사 이름이 `null` 로 왔다 — 미들웨어는 통과시켰지만 RLS 가
막은 것이다. 두 겹이 아니었으면 모르고 지나갔을 것이다.

### 신원은 트랜잭션마다 넣는다

RLS 전체가 `app.session_user_id()` 하나를 본다. `src/db/pool.js` 의 `tx()` 밖으로
업무 쿼리가 나갈 수 없게 만든 이유다 — 풀에서 꺼낸 클라이언트를 직접 주지 않는다.

```js
await tx(userId, async (q) => {          // SET LOCAL app.user_id
  const rows = await q.all('select ...'); // RLS 가 적용된다
});                                       // 커밋과 함께 값이 사라진다
```

`SET LOCAL` 이라 커넥션 풀에 신원이 새지 않는다. 안 넣으면 아무것도 안 보인다
(안전한 실패). 잘못 넣으면 남의 농장이 보인다 — 그래서 이 한 곳에만 둔다.

## 화면이 계산하지 않게 한다

일보 저장 API 는 **전일두수·당일두수·폐사두수를 받지 않는다.** 받으면 거짓말이
저장된다.

| 값 | 누가 정하나 |
|---|---|
| 전일두수 | V2 트리거 — 직전 확정본의 당일두수 |
| 당일두수 | 생성열 — 입력할 수 없다 |
| 폐사두수 | 폐사 원장에서 파생 (V7) |

팀장은 **변동분만** 넣는다 (§8.1). 설계문서 P5 「계산은 전부 시스템이」가
API 수준에서도 지켜진다.

조회 API 는 반대로, 아직 입력 안 된 행까지 **골격으로 만들어** 내려보낸다.
돈사마다 있어야 할 행이 다르므로(`count_basis`) 화면이 그 규칙을 다시 구현하면
L1-COMPLETE 와 어긋난다.

## 왜 서버에서 PDF 를 만드는가

설계문서 §6.5 — HACCP 은 전자기록을 인정하지 않는다. 종이를 3년 보관해야 한다.
그래서 시스템이 **일보 출력물을 생성**해야 한다. 방향이 반대다.

출력물과 시스템 데이터가 같다는 것은 `content_hash` 로 증명한다.
브라우저에서 PDF 를 만들면 이 증명이 성립하지 않으므로 서버에서 구워야 하고,
Chromium 이 도는 서버가 한 대 필요하다. Cloudflare Workers·Supabase Edge
Functions 에서는 돌지 않는다.

## 쓰는 법

```bash
npm install
npm run pdf -- JADON out/자돈사.pdf      # 한 건
node src/pdf/render-all.js 2026-08-18   # 3종 일괄 + PNG
```

Chromium 을 내려받지 않고 시스템 Chrome 을 쓴다(`puppeteer-core`).
경로는 `CHROME_PATH` 로 지정한다.

> **컨테이너에 올릴 때** `chromium` 과 **한글 글꼴**을 같이 깔아야 한다.
> 글꼴이 없으면 조용히 네모(□)로 나온다 — 출력물이 완성될 때까지 아무도 모른다.
>
> ```dockerfile
> RUN apt-get update && apt-get install -y --no-install-recommends \
>       chromium fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
> ENV CHROME_PATH=/usr/bin/chromium
> ```

## 일보 레이아웃이 세 가지인 이유

돈사마다 일보의 행을 쪼개는 축이 다르다 (`house.count_basis`).
현행 엑셀 5종을 판독해 확인한 사실이며, DB 스키마도 같은 구분을 쓴다.

| `count_basis` | 행 구성 | 돈사 |
|---|---|---|
| `pen` | 돈방 × 돈군 | 자돈사 · 육성사 · 검정사 · 비육사 |
| `pen_category` | 돈방 × 축종구분 | 분만1동 · 분만2동 |
| `category` | 돈사 × 축종구분 (돈방 없음) | 순치사 · 종부사 · 임신1·2동 |

열 이름도 돈사마다 다르다 — 같은 자리를 육성사는 「위탁판매(외부)」,
검정사는 「종돈 분양 판매(외부)」, 비육사는 「비육출하」라고 부른다.
심사 때 위화감이 없어야 하므로 그대로 따랐다.

## 샘플은 진짜 데이터다

`sample.js` 는 `db/migration/m3_pen_daily.csv` 를 읽는다. 현행 엑셀을 판독한
실제 값이라 출력물을 원본과 눈으로 대조할 수 있다.

2026-08-18 자돈사 합계가 **3,359두**로 나오는데, 설계문서 §11.3 이
「8/18 자돈사 두수는 3,359두가 정답」이라고 확인해 둔 값과 같다.
엑셀 판독 → CSV → 시스템 계산 → PDF 의 전 경로가 한 번 검증된 셈이다.

다만 표에 찍히는 당일두수는 **엑셀 기재값이 아니라 시스템이 다시 계산한 값**이다
(설계문서 P5 / V1). 그래야 계산 실수가 출력물로 넘어가지 않는다.

## 아직 없는 것

| # | 항목 | 비고 |
|---|---|---|
| 1 | DB 연결 | 지금은 CSV 를 읽는다. `v_pen_daily` 조회로 바꾸면 된다 |
| 2 | 빈 돈방 행 | 샘플은 값이 없는 돈방을 건너뛴다. 실제로는 L1-COMPLETE 가 전 돈방 입력을 요구하므로 모두 찍힌다 |
| 3 | 월계 폐사 | 열은 있으나 M3 CSV 에 없어 비어 있다 |
| 4 | 분만·이유·도폐사 현황표 | 분만사 일보의 하위 표 3종 |
| 5 | 이동 1:N 대사 · 예외 큐 SSE | §5.5 / §5.8 |
| 6 | 폐사·도태·약품·백신 등록 | §4.7 / §4.9 |
| 7 | 2단계 인증 (본사 계정) | §6.7 |
| 8 | Dockerfile | `infra/docker-compose.yml` 의 `api` 서비스가 참조한다 |
