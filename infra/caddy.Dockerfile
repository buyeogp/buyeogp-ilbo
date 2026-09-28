# 화면(web)을 빌드해 Caddy 이미지에 넣는다
#
# 원래는 화면을 Cloudflare Pages 에 따로 올릴 계획이었다. 사용자가 사무실 PC 3대와
# 본사뿐이라 CDN 이 줄 이득이 없고, 대신 도메인 네임서버를 옮기고 계정을 하나 더
# 만들어야 했다. 같은 서버에서 내보내면 화면과 API 가 같은 주소라 CORS 도,
# 주소 넘김 규칙(_redirects)도 필요 없다.
#
# 빌드 맥락은 저장소 루트다 (docker-compose.yml 의 caddy.build.context: ..).

# ── 1단계 : 화면 빌드 ────────────────────────────────────────────────
FROM node:24-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ── 2단계 : Caddy 에 결과물만 싣는다 ─────────────────────────────────
# Caddyfile 은 굽지 않는다 — compose 가 볼륨으로 붙이므로 고쳐도 다시 빌드할 필요가 없다.
FROM caddy:2-alpine
COPY --from=web /web/dist /srv/web
