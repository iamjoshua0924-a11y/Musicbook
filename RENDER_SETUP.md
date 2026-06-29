# Render 배포 준비 메모 (musicbook-server)

이 프로젝트는 **Node(Express + Socket.io)** 웹 서비스로 배포하면 됩니다.

## 1) Render 서비스 유형
- **Web Service**

## 2) 런타임 / 커맨드
- Node 버전: `20.x` (package.json `engines.node`)
- Build Command: `npm ci`
- Start Command: `npm start`

헬스체크:
- `GET /health` (또는 `GET /api/health`)

## 3) 필수 환경변수(없으면 서버가 바로 종료됨)
서버 부팅 시 `src/config/env.js`에서 아래 값들을 **무조건 required**로 읽습니다:
- `MONGODB_URI`
- `SESSION_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`

추가 권장:
- `NODE_ENV=production`
- `PUBLIC_BASE_URL` (예: Render에서 부여된 서비스 URL)

## 4) GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 만들기
서비스 계정 JSON 키 파일 전체를 base64로 인코딩한 “1줄 문자열”이 필요합니다.
- 코드 상 고정 로직:
  - `JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8'))`

## 5) Drive Sync 실행 방식
Drive Sync는 이제 **자동 실행되지 않습니다.**
서버 부팅 후 주기 실행/백그라운드 실행 없이, 관리자 화면에서 버튼을 눌렀을 때만 수동으로 돌아갑니다.

## 6) Puppeteer(Chrome for Testing) 설치 관련
`postinstall` 스크립트에서 다음을 실행합니다:
- `npx puppeteer browsers install chrome`

Render에서 디스크/캐시 이슈가 생기면 아래 환경변수로 캐시 경로를 고정하는 방식이 도움이 될 수 있습니다:
- `PUPPETEER_CACHE_DIR=/opt/render/project/src/.cache/puppeteer`
