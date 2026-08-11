# 악보 없는 곡 / 코드위키 링크 곡 입력 설계안

## 목표

현재 `Song` 모델과 노래 열기 흐름은 사실상 `googleFileId + Drive PDF` 전제를 갖고 있다.  
그래서 아래 2가지 유형을 같은 "가능곡" 목록에 넣으려면 데이터모델과 열기 UX를 분리해야 한다.

- `악보 없음`: PDF/Drive 파일은 없지만 목록에는 넣고 싶음
- `코드위키 링크`: PDF 대신 외부 링크(예: 코드위키)로 바로 이동시키고 싶음

## 현재 제약

현재 구조의 핵심 제약:

- `Song.googleFileId`가 필수 + unique
- `viewer` 열기 흐름이 `fileId` 중심
- `availability`도 `googleFileId` 기준
- 셋리스트/신청곡/세션 follow도 기본적으로 파일 ID 중심

즉 지금 상태에서는 “파일이 없는 곡”을 억지로 넣으려면 가짜 fileId를 만들어야 하는데,
이건 장기적으로 데이터 의미가 꼬일 가능성이 높다.

## 권장 방향

## 1. Song에 sourceType 추가

`Song`에 아래 필드를 추가하는 방향을 권장한다.

```js
sourceType: { type: String, enum: ['drive_pdf', 'external_link', 'no_score'], default: 'drive_pdf', index: true }
externalUrl: { type: String, default: '' }
externalLabel: { type: String, default: '' } // 예: '코드위키'
openMode: { type: String, enum: ['viewer', 'external', 'none'], default: 'viewer' }
```

의미:

- `drive_pdf`
  - 기존 방식
  - `googleFileId` + `driveUrl`
  - `openMode = viewer`

- `external_link`
  - PDF는 없고 외부 링크 있음
  - `externalUrl`
  - `externalLabel = '코드위키'`
  - `openMode = external`

- `no_score`
  - 악보/외부링크 모두 없음
  - 목록에는 보이되 열기 없음
  - `openMode = none`

## 2. googleFileId 필수 제약 완화

권장 변경:

- `googleFileId`를 `required: false`로 변경
- 대신 `sourceType === 'drive_pdf'`일 때만 `googleFileId` 필요

방법은 2가지가 있다.

### A안: 스키마 validator로 조건부 필수

장점:
- 의미가 가장 깨끗함

단점:
- 기존 unique 인덱스 조정 필요

### B안: 앱 레벨에서 검증

예:

```js
if (sourceType === 'drive_pdf' && !googleFileId) BAD_REQUEST
if (sourceType === 'external_link' && !externalUrl) BAD_REQUEST
```

초기 구현은 B안이 더 안전하다.

## 3. availability 기준키 분리

지금 `Availability`는 `googleFileId` 기준이다.  
파일 없는 곡도 가능곡으로 넣으려면 “곡 식별자”를 파일 ID가 아니라 **songEntryId** 같은 논리 ID로 분리하는 게 좋다.

권장:

- `Song.entryId` 추가 (문자열 UUID)
- `Availability.songEntryId` 추가
- 점진적으로 `googleFileId` 기반에서 `songEntryId` 기반으로 전환

단기 타협안:

- 외부 링크/악보없음 곡에 대해 `googleFileId` 대신
  - `ext:<uuid>`
  - `noscore:<uuid>`
  같은 synthetic id를 사용

장점:
- 기존 availability/셋리스트/필터 흐름을 거의 안 깨고 빠르게 붙일 수 있음

단점:
- 이름은 `googleFileId`인데 실제로는 Drive file이 아님
- 장기적으로 의미가 흐려짐

## 추천

빠른 구현은 `synthetic id` 방식,
장기적으로는 `entryId` 분리가 더 맞다.

## 4. UI 입력안

관리자 곡 추가/수정 UI에 `입력 방식` 선택을 추가:

- `Drive PDF`
- `코드위키 링크`
- `악보 없음`

필드 노출 규칙:

### Drive PDF

- `googleFileId` 또는 `driveUrl`
- 기존과 동일

### 코드위키 링크

- `externalUrl`
- `externalLabel` 기본값: `코드위키`

### 악보 없음

- 링크 입력 없음
- 단, 비고성 필드가 필요하면 `externalLabel = '악보없음'` 정도만 표시

## 5. musicbook 열기 UX

현재 카드 액션 모달은 보통

- 뷰어 열기
- 링크 열기

쪽으로 이어진다.

이를 `sourceType`에 따라 분기:

### drive_pdf

- 지금처럼 `viewer` 열기

### external_link

- 버튼 라벨: `코드위키 열기`
- `window.open(externalUrl, '_blank')`
- 세션 follow 대상에서는 제외하거나, follow 시에는 링크만 공유하는 별도 UX 필요

### no_score

- 버튼 라벨: `악보 없음`
- 클릭 시 토스트:
  - `이 곡은 아직 악보가 등록되지 않았어요.`

## 6. 셋리스트 동작

셋리스트에는 세 유형 모두 들어갈 수 있게 하는 걸 권장한다.

필드 예:

- `songType`
- `openMode`
- `externalUrl`

셋리스트 클릭 시:

- `drive_pdf` → viewer 또는 drive link
- `external_link` → 외부 링크 열기
- `no_score` → 안내 토스트

## 7. 세션/리허설 동작 원칙

여기서는 구분이 필요하다.

### drive_pdf

- 기존대로 세션 팔로우 가능

### external_link

- 1차에서는 세션 팔로우 제외 권장
- 이유: 세션 싱크는 `viewer/fileId/pageNo` 중심이라 의미가 맞지 않음

### no_score

- 세션 팔로우 제외

즉 1차 릴리스에서는:

- 가능곡 목록/개인노래책/셋리스트에는 보임
- 세션 page-turner 대상은 `drive_pdf`만 허용

## 8. 검색/필터

세 유형 모두 검색에는 동일하게 포함:

- 제목
- 아티스트
- 장르
- 분위기
- 보컬
- 키

추가로 source badge를 두면 좋다.

- `PDF`
- `코드위키`
- `악보없음`

## 9. 구현 순서 추천

### 1단계

- `sourceType`, `externalUrl`, `externalLabel`, `openMode` 추가
- 관리자 곡 추가/수정 UI에 입력 방식 추가
- 카드 액션 모달 분기

### 2단계

- 셋리스트/개인노래책에서 external/no_score 지원

### 3단계

- 필요하면 `entryId` 중심으로 availability 구조 정리

## 최종 추천

실제 구현은 아래 조합이 제일 현실적이다.

### 빠른 버전

- `sourceType`
- `externalUrl`
- synthetic id (`ext:...`, `noscore:...`)
- 세션 follow는 `drive_pdf`만

장점:
- 기존 구조를 크게 안 깨고 바로 붙일 수 있음

### 정석 버전

- `entryId` 기반으로 Song/Availability/Setlist 식별자 재정리

장점:
- 구조가 가장 깔끔함

단점:
- 범위가 커짐

## 결론

지금 요구사항에는 **빠른 버전**이 맞다.

즉:

- 관리자에서 `Drive PDF / 코드위키 링크 / 악보 없음` 셋 중 하나로 곡 추가
- `코드위키 링크`는 바로 외부 링크로 열기
- `악보 없음`은 목록/셋리스트에는 보이되 열기는 막기
- 세션 동기화는 기존 PDF 곡만 유지

이렇게 가면 가장 적은 충돌로 원하는 UX를 만들 수 있다.

---

# 개정 (2026-08-11): entryId 우선으로 결정 변경

이 절은 위 문서의 "최종 추천(빠른 버전 = synthetic id)"을 뒤집는다.
형식: 기존 결정 → 새로운 정보 → 변경 이유 → 새로운 결정

## 기존 결정

- `googleFileId`에 `ext:<uuid>` / `noscore:<uuid>` 같은 synthetic id를 넣어
  기존 availability/셋리스트 흐름을 안 깨고 빠르게 붙인다.
- `entryId` 분리는 3단계(선택)로 미룬다.

## 새로운 정보 (코드 확인으로 드러난 사실)

### 1. 문제가 두 축이다

원 문서는 "악보가 **없는** 곡"만 다룬다. 그러나 실제 병목은 두 개다.

- **A. 악보가 영영 없는 곡** — 코드위키 링크만 있거나 아예 없음
- **B. 악보는 있는데 아직 Drive/DB에 없는 곡** — 등록 자체가 병목

가능곡을 고를 때 "DB에 갱신해 둔 곡 안에서만 고를 수 있다"는 불편은 주로 **B**다.
B의 핵심은 *지금 목록에 넣고, 나중에 악보가 Drive에 올라오면 그 항목과 합쳐지는*
화해(reconciliation) 경로인데, 원 문서에는 이 경로가 없다. 없으면 중복 곡이 쌓인다.

### 2. synthetic id는 Drive 동기화에 지워질 수 있다

`src/services/driveSync.js`의 prune:

```js
await Song.updateMany(
  { syncRootId: rootFolderId, lastSeenAt: { $lt: startedAt }, hidden: { $ne: true } },
  { $set: { hidden: true } }
);
```

전체 동기화를 돌리면 이번 스캔에서 못 본 곡은 전부 `hidden: true`가 된다.
synthetic 곡에 `syncRootId`가 실수로 채워지면 다음 동기화에서 **조용히 사라진다.**
원 문서는 이 위험을 언급하지 않는다.

### 3. 같은 유형의 버그가 이미 존재한다

`src/routes/privateRequests.js`의 승격(promote):

```js
await Availability.updateOne(
  { userId: user.userId, googleFileId },   // googleFileId가 '' 일 수 있다
  { $set: { userId: user.userId, googleFileId, available: true } },
  { upsert: true }
);
```

`normalizeRequest`는 `googleFileId`를 빈 문자열로 허용하고,
`Availability`에는 `{ googleFileId, userId }` unique 인덱스가 걸려 있다.
→ 악보 없는 신청곡을 **두 개 이상 승격하면 서로 덮어써서 사용자당 하나만 남는다.**

## 변경 이유

`googleFileId` 필드에 Drive 파일이 아닌 값이 섞이는 순간,
동기화·승격·셋리스트가 각자 "이 문자열이 진짜 Drive 파일인가"를 판단해야 한다.
위 3번은 정확히 그 유형의 버그이고, synthetic id를 도입하면 같은 유형이 계속 재생산된다.
"빠른 버전"의 이득(기존 흐름 보존)보다 이 비용이 크다.

결정적으로, **B의 화해 경로가 synthetic id에서는 성립하지 않는다.**
`noscore:<uuid>`로 등록한 곡에 나중에 악보가 생기면 id를 `googleFileId`로 바꿔야 하는데,
그 순간 availability/셋리스트/숙련도의 참조가 전부 끊긴다.

## 새로운 결정

곡의 정체성을 `entryId`로 두고, `googleFileId`는 **"이 곡에 붙은 악보 파일"이라는 속성**으로 강등한다.

```js
Song {
  entryId,                                   // UUID, 곡의 정체성 (PK 역할)
  title, artist, key, genre, mood, vocal,
  sourceType,                                // 'drive_pdf' | 'external_link' | 'no_score'
  googleFileId,                              // sourceType==='drive_pdf'일 때만 의미 있음
  externalUrl, externalLabel,
  syncRootId                                 // drive_pdf가 아니면 반드시 '' 로 둔다
}

Availability { entryId, userId, available, proficiency }
```

이 구조에서:

- **A**는 `sourceType`으로 표현된다.
- **B**는 `sourceType: 'no_score'`로 먼저 등록해 두고, 나중에 Drive에 악보가 뜨면
  그 곡의 `googleFileId`만 채우고 `sourceType`을 `drive_pdf`로 승격한다.
  **`entryId`가 안 바뀌므로 가능곡·셋리스트·숙련도가 그대로 따라온다.**

## 안전장치 (필수)

1. **prune 이중 방어** — synthetic/no_score 곡은 `syncRootId`를 빈 값으로 두고,
   추가로 prune 쿼리에 `sourceType: 'drive_pdf'` 조건을 명시한다.
   둘 중 하나만 두면 나중에 누군가 한쪽을 깨뜨렸을 때 조용히 곡이 사라진다.
2. **승격 경로 가드** — `googleFileId`가 빈 값이면 `Availability` upsert를 막는다.
   (entryId 전환 전이라도 이 가드는 지금 넣을 수 있다.)
3. **악보 매칭은 자동화하지 않는다** — 제목/아티스트 정규화 매칭은 오탐이 난다.
   잘못 붙으면 다른 곡의 악보가 열린다. 관리자 화면의 **"악보 매칭 후보" 큐**로 두고
   사람이 확인해서 연결한다.

## 마이그레이션

1. 기존 모든 곡에 `entryId = googleFileId` 값으로 채우고,
   `sourceType = 'drive_pdf'`로 백필한다. → 이 단계에서 동작은 전혀 바뀌지 않는다.
2. `Availability`에 `entryId`를 추가하고 같은 방식으로 백필한다.
   (`googleFileId` 컬럼은 당분간 함께 유지해 롤백 여지를 남긴다.)
3. 읽기 경로를 `entryId` 기준으로 전환한다.
4. 쓰기 경로를 전환하고, 마지막에 `Availability.googleFileId`를 제거한다.

## 세션 동기화 원칙 (원 문서 유지)

세션 page-turner 동기화는 `viewer/fileId/pageNo` 중심이므로
1차에서는 `drive_pdf`만 팔로우 대상으로 허용한다. `external_link` / `no_score`는 제외한다.
