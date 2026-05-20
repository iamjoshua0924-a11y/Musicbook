#
# Render Docker 배포용
# - puppeteer-core 구동을 위한 Chromium 포함
# - bcrypt 등 native module 설치 실패 방지를 위해 build deps를 분리(멀티스테이지)
#

FROM node:20-bookworm-slim AS deps

# Native module build deps (npm ci 단계에서만 필요)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runner

# Chromium + fonts for puppeteer-core
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# deps stage에서 설치한 node_modules를 그대로 복사
COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000
CMD ["npm","start"]
