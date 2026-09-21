# 부여GP 일보 API
#
# 이 이미지가 존재하는 이유의 절반은 **Chromium** 이다.
# HACCP 은 전자기록을 인정하지 않으므로 시스템이 종이를 만들어야 하고(§6.5),
# 출력물과 데이터가 같다는 증명(content_hash)이 서버에서 나와야 한다.
# 그래서 서버리스로는 구성할 수 없고, Chromium 이 도는 자리가 필요하다.
#
# Chromium 은 내려받지 않고 **배포판 패키지**를 쓴다 (puppeteer-core).
# 이미지가 200MB 쯤 가벼워지고 보안 업데이트를 apt 가 맡는다.

# ── 1단계 : 의존성만 ──────────────────────────────────────────────────
# 운영 의존성만 설치해서 다음 단계로 넘긴다. npm 캐시는 여기서 버려진다.
FROM node:24-bookworm-slim AS deps

WORKDIR /app/api
COPY package.json package-lock.json* ./
# package-lock.json 이 있으면 ci, 없으면 install — 둘 다 devDependencies 는 뺀다
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi


# ── 2단계 : 실행 ─────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime

# chromium        일보 PDF (§6.5)
# fonts-noto-cjk  한글. 없으면 PDF 의 모든 글자가 네모로 나온다
# dumb-init       PID 1. 렌더가 죽었을 때 남는 Chromium 좀비를 거둔다
# wget            컨테이너 healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto-cjk \
      dumb-init \
      wget \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    TZ=Asia/Seoul

# 일보 PDF 를 쓰는 곳. 컨테이너가 다시 뜨면 사라지는 자리라 보관본은
# Supabase Storage(daily-report-pdf 버킷)에 올린다.
RUN mkdir -p /app/api/out && chown -R node:node /app

WORKDIR /app/api
COPY --from=deps --chown=node:node /app/api/node_modules ./node_modules
COPY --chown=node:node . .

# root 로 돌리지 않는다. render.js 가 이미 --no-sandbox 로 띄우므로
# SYS_ADMIN 없이도 Chromium 이 뜬다.
USER node

EXPOSE 3000

# Puppeteer 는 /dev/shm 을 크게 쓴다. compose 가 shm_size 512mb 를 준다 —
# 직접 docker run 으로 띄울 때는 --shm-size=512m 를 붙인다.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
