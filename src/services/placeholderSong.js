const crypto = require('crypto');

// Song.googleFileId는 required+unique 제약이 그대로 유지된다(악보 없는 곡/개인 전용 곡도 예외 없음).
// 실제 Drive 파일이 없는 문서(hasScoreFile:false 또는 scope:'private')를 만들 때
// googleFileId 자리에 채워 넣을 합성 ID를 만든다.
//
// "local-" 접두어로 실제 Drive fileId(항상 영숫자/-/_ 조합, 이 접두어를 쓰지 않음)와
// 확실히 구분되게 한다 - 이후 다른 로직이 "이 문자열이 진짜 Drive 파일을 가리키는가"를
// 판단해야 할 때(예: Drive API 호출 전 스킵) 접두어만 보고 걸러낼 수 있다.
//
// NOTE: 이번 phase에서는 이 헬퍼를 호출하는 곳이 없다. 다음 phase(가능곡 추가 UI)에서
// placeholder Song 문서를 생성할 때 사용한다.
function generatePlaceholderGoogleFileId() {
  return `local-${crypto.randomUUID()}`;
}

function isPlaceholderGoogleFileId(googleFileId) {
  return String(googleFileId || '').startsWith('local-');
}

module.exports = { generatePlaceholderGoogleFileId, isPlaceholderGoogleFileId };
