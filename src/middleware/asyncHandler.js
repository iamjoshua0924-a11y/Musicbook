/**
 * asyncHandler — async 라우트 핸들러의 rejection을 Express 에러 파이프라인으로 전달.
 *
 * Express 4는 async 핸들러가 반환한 rejected Promise를 자동으로 잡지 않는다.
 * 그 결과 DB 순단/캐스팅 오류/쿼리 예외 1건이 unhandledRejection이 되어
 * 프로세스 전체를 종료시킨다(2차 감사 P0-1, 실측 재현).
 *
 * 이 래퍼로 감싸면 rejection이 next(err)로 흘러 app.js의 전역 에러 핸들러가
 * { ok:false, error } JSON 500으로 응답하고, 서버는 살아남는다.
 *
 * 기존에 developer/chordUpload/proxyChord/chordDoc 4개 라우터가 각자 동일한
 * 구현을 중복 정의하고 있었다(2차 감사 §9-2). 이 모듈로 1본화한다.
 */
function asyncHandler(fn) {
  return function asyncHandlerWrapped(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
