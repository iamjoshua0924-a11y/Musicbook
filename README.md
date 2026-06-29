# musicbook-server (WIP)
Express + Socket.io + MongoDB + Google Drive proxy 기반 통합 서버의 “골격”입니다.

## 1) 설치/실행
```bash
npm install
cp .env.example .env
npm run dev
```

## 2) 핵심 환경변수(고정)
### Google 서비스 계정 키(Base64)
- Key: `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`
- Value: 서비스 계정 JSON 키 파일 전체를 **base64로 인코딩한 1줄 문자열**

Node에서 사용 로직은 다음으로 **고정**되어 있습니다:
```js
JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8'))
```

## 3) Drive 헬퍼 API
악보(PDF) 데이터는 서버가 중계하지 않고, 브라우저가 Google Drive 공개 URL에서 직접 로드합니다.
- `GET /api/drive/preview/:fileId` (preview/view URL 반환)
- `GET /api/drive/view/:fileId` (Drive view로 리다이렉트)
- `GET /api/drive/meta/:fileId` (관리자/세션용 메타 조회)

## 4) Socket.io (세션 룸 + 페이지 터너)
세션 룸: `room:session:<ROOM_CODE>`

주요 이벤트:
- `session:create` → roomCode 발급
- `session:join` / `session:leave`
- `session:pageTurner:transfer` + `session:pageTurner:sync_request` (양도 직후 즉시 재정렬)
- `viewer:page_change` (페이지터너만 브로드캐스트)
- `session:follow:file` (페이지터너만 곡 전환 브로드캐스트)
- `wb:page:update` (페이지별 스냅샷 SSOT)

## 5) GitHub Push
현재 실행 환경에는 `git`이 설치되어 있지 않아 제가 직접 push를 수행할 수 없습니다.  
대신 이 폴더를 그대로 로컬에서 git init 후 push 해주세요.
