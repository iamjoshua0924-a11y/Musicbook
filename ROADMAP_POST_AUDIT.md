# 2차 전수감사 이후 — 최종 개선 로드맵 & UX Evolution Plan

> 기준: 2차 전수감사보고서 + 실제 저장소 재검증 (브랜치 `claude/musicbook-audit-ux-evolution-beyzu9`, 기반 커밋 `ecb79bc`)
> 검증 방법: 감사 항목별 코드 대조(3영역 병렬) + `npm ci` 실측 + 통합 테스트(`npm run test:integration`) 32건 전부 PASS 확인.
> 중요 사실: **감사 후 P0/P1 개선 커밋 13개는 `claude/musicbook-reconnaissance-bon55a`에만 있었고 main에 미병합** 상태였다. 본 브랜치는 그 위에서 시작한다.

---

## A. Current State — 실코드 기준 재분류

### [해결됨] (개선 브랜치에 존재, 본 세션에서 재확인)
| 항목 | 확인 근거 |
|---|---|
| P0-1 asyncHandler + unhandledRejection | src/middleware/asyncHandler.js, 전 라우터 적용, src/server.js 안전망 |
| P0-2 lockfile | `npm ci` 실측 성공 |
| NEW-1 세션 영속 | connect-mongo(httpSessions), 통합 테스트 PASS |
| VC-01 setSpreadOverlapPx | a92ee00, 함수 정의 존재 |
| VC-03 참가자 XSS | 087629b |
| VA-01~04 주석 lifecycle 4대 | ec0526a (fileId 스코프/원격 전체삭제/다곡 백업/live-first 복원) |
| DS-01 수동 편집 원복 | b1bc772 + 테스트 8건 PASS |
| DS-02 onProgress rejection | b1bc772 (fire-and-forget catch) |
| DS-03b 부팅 시 stale running 청소 | src/server.js:58-74 + 테스트 PASS |
| DS-08 BAD_TOKENS 오탐 | 세그먼트 매칭, `단발머리-최양락-Live` 미숨김 실행 재현 |
| UX-1 전체화면 모달 | e83e7ef |
| UX-2 CDN SRI/폴백 | ecb79bc |
| UX-3 곡 로드 에러/재시도 (loadSongs 한정) | 3585344 |
| MB-5 보컬 필터 고착 | 3585344 |
| CHORD-3 파서 rate limit | b93c3e6 |
| PB-2 body userId 신뢰 | 112f4d2 + 테스트 PASS |
| PB-6 bookAccess 게이트 | 3a9f020 + 테스트 PASS |

### [부분 해결]
- **VA-06**: 사용자 조작 경로는 flush로 차단. `session:follow:file` 수신 경로만 fileId 변경 후 flush 잔존(피해는 축소됨).
- **VA-08**: 서버는 fileId별 분리 완료. 로컬 annoStore가 pdf↔chord 모드 토글 시 미리셋 → 블리드 잔존.
- **DS-05**: skip 브랜치가 folderPath 등은 채우나, 신규 생성 문서는 searchText/key/genre/mood/vocal/스키마 default 결손.
- **MB-4**: loadSongs만 에러 UI. loadSongFiles 생 throw + 편집 취소 onclick catch 부재 + 취소 실패 시 체크박스 즉시저장 역전 잔존.
- **VC-14**: _seq 세대 토큰으로 DOM 오염은 방지, renderTask.cancel() 미호출.
- **CORE-05**: 로그인 검증은 bcrypt 완료. 그러나 `User.currentPasswordText` 평문 병행 저장 + admin API/UI 노출 잔존 → **정책 결정 필요**.
- **DS-09**: 45초 1회용 grant 게이트는 존재. 발급되는 토큰 자체는 SA 전역 drive.readonly(파일 스코프 없음) + rate limit 미적용 → **SA 공유 범위 확인 필요(정책)**.

### [미해결] (P2 — 이번 단계 대상)
- 뷰어/주석: **VA-05**(텍스트 250ms 유실), **VA-07**(session:state 미리셋), **VA-10**(300KB 무통지 — ack 미사용), **VA-11**(레이저 박제), **VC-02**(`pref` 미정의 → compact 문서 렌더 전면 실패), **CHORD-5**(compact 3중 복제·proxyChord 첫글자 절단), **VC-05**(follow chord→pdf setMode 누락), **VC-06**(HiDPI 흐림), **VC-07**(pdfDoc.destroy 부재)
- Drive: **DS-03a**(최종 status 덮어쓰기 레이스), **DS-04**(incremental 기준 endedAt→startedAt), **DS-06**(SEEN_DROP prevCount 인플레), **DS-07**(수동 숨김/해제가 매 sync 원복), **DS-12**(API timeout·updateOne 무보호)
- 개인 노래책: **PB-3**(attach 후 옛 Drive 파일 잔존→중복 부활), **PB-4**(승격 시 셋리스트/신청곡 미이관)
- 메인: **MB-1**(부트 직렬 워터폴+cards 2회), **MB-2**(편집 진입 정렬 리셋), **MB-3**(검색 시맨틱 이중화), **MB-6**(두 sync 버튼 동일 동작+연타 중단), **MB-7**(제출 연타 가드 부재)
- UX: **UX-4**(viewer.css 모바일 블록 사문화), **UX-5**(시트 teardown 빈 패널), **UX-6**(직접 라우트 asset 404), **UX-7**(config.js 프로덕션 고정), **UX-8**(z-index 역전: 모달 2000 < 패널 2500~3000), **UX-9**(pdf fake worker), **UX-10**(46vh 공백 — musicbook.css), **UX-11**(setlist 오버라이드 캐스케이드 패배), **UX-12**(/requests 상태 전무), **UX-13**(메인↔목록 history 미반영), UX-15(접근성)
- 구조(장기): **VA-09**(페이지 LWW — Phase 4 기록)

### [존재하지 않음]
- **CHORD-6 / CHORD-7**: 감사보고서·저장소 전체에 해당 식별자 없음. (보고서에 정의된 CHORD 항목은 2~5뿐.) → 정의 확인 전 작업 불가, 기록만.

### [DECISION REQUIRED] — 소유자 결정 전 변경 금지
1. **PB-5**: admin 계정이 본인 개인 노래책 오너일 때 편집 전면 잠금(musicbook.js:3901-3910, `:3908`이 오너 판정을 무조건 덮음). 의도인지 확인 필요. *제안: `if (isAdmin && !isOwner)`로 바꾸면 오너 겸 admin은 편집 가능 — 승인 시 1줄.*
2. **CORE-05**: `currentPasswordText` 평문 병행 저장·admin 노출. GAS 운영 워크플로(관리자가 멤버 비번 조회) 호환 목적으로 보임. *제거/유지/열람 로그 추가 중 선택 필요.*
3. **DS-09**: 전역 readonly 토큰 → 파일 단위 다운로드 프록시로 전환 여부. SA 공유 범위(루트 폴더 외 자원) 확인 선행. *이번 단계에서는 rate limit 공통 미들웨어만 적용 가능(비파괴).*

### [배포 후 검증 필요] — 코드 수정 없이 별도 관리 (Phase 0)
DV-01 세션 뷰어 2기기(줌/팬 팔로우, VC-01·3.6) · DV-02 전체화면 modal(UX-1/MUST-2) · DV-03 페이지 왕복 annotation(3.5) · DV-04 Drive rename→full sync title 갱신(DS-01 mtime 전제) · DV-05 Atlas 재배포 후 로그인 유지(NEW-1) · DV-06 connect-mongo v6 ↔ Node>=20.8(엔진 20.x, Render 런타임 확인)

---

## B. Final Engineering Roadmap (dependency 순)

**Phase 0 — Deployment Verification** *(코드 변경 없음)*: 위 DV-01~06을 REGRESSION_CHECKLIST.md에 체크리스트로 명문화. 개선 브랜치 배포 후 실기기 검증.

**Phase 1 — P2 Stability** *(UX 단계의 선행 의존)*
- 1a 서버/Drive: DS-03a → DS-04 → DS-05 → DS-06 → DS-07 → DS-12 → PB-3 → PB-4. *(DS-04/05가 고쳐져야 Phase 2의 "최신곡 추가=incremental" 연결이 안전해짐)*
- 1b 뷰어/주석: VC-02+CHORD-5(compact 1본화) → VA-05/07/08잔여/10/11 → VC-05/06/07/14 → UX-9. *(VA-10 ack가 Phase 2 저장 상태 표시의 기반)*

**Phase 2 — UX Evolution** (§C): MB-1/2/3/4잔여/6/7 + UX-4~13 + journey 개선(셋리스트→뷰어, 이전/다음 곡, sync 진행 표시, 최근 곡, URL 상태).

**Phase 3 — Policy**: PB-5 / CORE-05 / DS-09 — 결정 후 구현(각각 소규모).

**Phase 4 — Architecture**: ESLint(no-undef; VC-02류 재발 방지) → esc/apiGet/ID판별 공통화 → 거대 파일 분리 → VA-09(LWW) 재설계 검토 → dead code 정리 → smoke/통합 테스트 확장.

**Phase 5 — Product Expansion**: §11 도메인 확장(대부분 소규모) + §12 개인화(익명=localStorage, 로그인=Availability 이원).

---

## C. UX Evolution Plan — 사용자 journey 기준

Journey: **Discovery → Song Selection → Viewer 진입 → Performance → Annotation → Next Song → Return/Re-discovery**, 인프라 축: **Drive → Sync → Songbook**.

| # | 단계 | 현재 friction | 개선 | 분류 | UX-P |
|---|---|---|---|---|---|
| 1 | Discovery | 부트 직렬 9-step 워터폴 + 같은 API 2회(MB-1) → 첫 화면 지연 | cards 1회 호출 공유 + 독립 호출 병렬화 | [STATE] | P1 |
| 2 | Discovery | "최근 본 곡" 개념 없음 — 매번 재검색 | `mb_recent_songs_v1`(localStorage) + 최근 곡 퀵 필터 | [NEW FEATURE] | P1 |
| 3 | Discovery | 검색/필터/보기 상태가 URL·저장소 어디에도 없음, 뒤로가기=사이트 이탈(UX-13) | 검색/필터/페이지 뷰를 URL 쿼리 replaceState + 메인↔목록 pushState/popstate | [COMPONENT] | P1 |
| 4 | Selection | 신청곡 검색만 서버 시맨틱(공백AND, 초성 불가) — 화면 간 검색 감각 불일치(MB-3) | 서버 검색에 공백무시 매칭 보강(정규화 규칙 공유) | [STATE] | P2 |
| 5 | Selection→Viewer | **셋리스트 항목 클릭 = 드라이브 링크 복사뿐**, 뷰어로 못 감 | 항목 클릭→뷰어 직접 열기(복사는 보조 버튼) | [COMPONENT] | **P0** |
| 6 | Selection | 제출/편집 버튼 연타 → 중복 데이터(MB-7), 편집 취소 실패 시 즉시저장 역전(MB-4) | in-flight 가드 공통화 + 취소 경로 안전화 | [COMPONENT] | P1 |
| 7 | Viewer 진입 | 뷰어는 fileId만 알고 곡 제목/컨텍스트를 모름; **이전/다음 곡 부재**, 곡 전환=뒤로가기→전체 재부트 | 진입 시 sessionStorage로 곡 컨텍스트(목록·위치·복귀 URL) 전달 → topbar 곡 제목 + 이전/다음 곡 + 목록 복귀 | [NEW FEATURE]+[STATE] | **P0** |
| 8 | Performance | HiDPI 흐림(VC-06), fake worker UI 프리즈(UX-9), 모바일 CSS 사문화(UX-4) | outputScale, worker script 제거, 모바일 블록 재배치 | [CSS/UI]+[COMPONENT] | P1 |
| 9 | Annotation | 저장 실패(300KB 등) 무통지(VA-10), 저장 상태 표시 전무 | ack 기반 저장 상태(저장됨/실패) HUD | [COMPONENT] | **P0** |
| 10 | System Status | sync 버튼: 진행 표시 0, 연타=재시작, 두 버튼 동일 동작(MB-6) | in-flight 가드 + status 폴링 진행 표시 + "최신곡 추가"=incremental(DS-04/05 선행) | [COMPONENT]+[STATE] | **P0** |
| 11 | System Status | /requests 실패 시 영구 백지(UX-12), loadSongFiles 생 throw | 로딩/에러/재시도 상태 | [CSS/UI] | P2 |
| 12 | Return | 직접 라우트 asset 404(UX-6), 로컬 개발이 프로덕션 DB 타격(UX-7) | 편의 라우트→canonical /public/... 리다이렉트, config.js localhost 분기 | [COMPONENT] | P2 |
| 13 | Responsive | 모달이 패널/시트 아래 깔림(UX-8), 시트 해제 시 빈 패널(UX-5), 46vh 공백(UX-10), setlist 오버라이드 사문화(UX-11) | z-index 스케일 정리 + teardown 후 재렌더 + padding 조건화 + 오버라이드 재배치 | [CSS/UI] | P1 |
| 14 | 접근성 | 모달 ESC/백드롭 없음, 카드 포커스 불가(UX-15) | 주요 모달 ESC/백드롭 닫기(취소 버튼 경유) | [CSS/UI] | P3 |

**넣지 않는 것**: 뷰어 페이지 넘김 애니메이션(무모션 원칙 존중), GSAP류 CDN 추가, 존재하지 않는 데이터 기반 탐색 UI, 전체 rewrite.

---

## D. First Implementation Phase = Phase 1 (P2 Stability)

선정 근거: Phase 2의 핵심 UX(#9 저장 상태=VA-10 ack, #10 incremental=DS-04/05, #7 곡 전환=뷰어 안정성)가 Phase 1 산출물에 의존. regression risk는 통합 테스트(32건) + mock-Drive sync 테스트로 방어.

- 대상 파일: src/services/driveSync.js, driveSyncRunner.js, drive.js / src/routes/songUpload.js / src/models/Song.js / src/routes/admin.js·developer.js(hidden 수동 플래그) / 신규 src/services/chordCompact.js / src/routes/{chordDoc,chordUpload,proxyChord}.js / public/viewer/viewer.js·index.html·viewer.css
- 검증: `npm run test:integration`(기존 32 + 신규 케이스), 뷰어는 정적 검사(node --check) + 코드 경로 추적, 회귀 4대 기능 영향 검토
- production Drive/DB 접근 없음(전부 mock/memory)
