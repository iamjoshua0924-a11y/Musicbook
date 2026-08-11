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

## 5) GitHub Push & 배포 파이프라인
Claude(Cowork) 세션에서 코드를 수정하면 아래 순서로 자동 반영됩니다.

```
Claude 코드 수정
  -> git commit (세션 내 최소 단위)
  -> git push origin main
  -> Render Auto-Deploy 트리거 (GitHub 연동, main 브랜치 기준)
  -> Render가 npm ci -> npm start로 재배포
```

- push는 fine-grained PAT(Contents: Read and write 권한)로 인증한다.
- Render 쪽 설정/필수 환경변수는 `RENDER_SETUP.md` 참고.
- 큰 구조 변경은 별도 브랜치 + PR로 진행하고, 사소한 수정은 main에 직접 push한다.
