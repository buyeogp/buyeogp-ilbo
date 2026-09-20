# API 서버

부여GP 돈사 일보 시스템의 백엔드. 설계문서 §7.1 이 정한 역할은 넷이다 —
**검증 룰 엔진 · 권한 · 일보 PDF 생성 · 실시간 예외 큐(SSE)**.

현재 들어 있는 것은 **일보 PDF 생성**뿐이다. 인프라 없이 만들 수 있고
HACCP 임계경로에 있기 때문에 먼저 했다.

```
api/
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
npm run migrate        # db/001~017 을 하나의 트랜잭션으로 적용
npm run migrate:reset  # 스키마를 지우고 다시 (개발 전용, 데이터 있으면 --force 필요)
npm run verify         # 트리거·생성열·RLS 가 실제로 동작하는지 43건
npm run load:m3        # 과거 4주치 3,681행 적재 + 엑셀 대조
npm run setup:role     # buyeogp_api 생성, RLS 가 정말 걸리는지 확인
```

접속 정보는 `infra/.env` 에서 읽는다. Supabase 직접 연결은 IPv6 전용이라
**Session pooler(IPv4)** 를 쓴다 — Transaction pooler 와 달리 세션 상태를 유지해서
`SET LOCAL app.user_id` 와 커스텀 역할이 그대로 동작한다.

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
| 5 | REST API · 인증 · SSE | §7.1 의 나머지 세 역할 |
| 6 | Dockerfile | `infra/docker-compose.yml` 의 `api` 서비스가 참조한다 |
