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
