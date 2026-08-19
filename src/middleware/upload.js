const path = require('node:path');
const multer = require('multer');

// 임의 파일 업로드 경로라 반드시 화이트리스트로 막는다. 스캔 악보 이미지도 받아야 해서
// pdf 외에 png/jpg/jpeg도 허용한다.
const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30MB
const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return cb(new Error('UNSUPPORTED_FILE_TYPE'));
  // 확장자만으로는 스푸핑될 수 있으니 mimetype도 병행 체크(이중 방어). 브라우저가 mimetype을
  // 못 채워보내는 극히 드문 경우까지 막진 않는다 - 파일 시그니처(매직바이트) 검증은 이번 phase 범위 밖.
  if (file.mimetype && !ALLOWED_MIME.has(file.mimetype)) return cb(new Error('UNSUPPORTED_FILE_TYPE'));
  cb(null, true);
}

// 디스크에 안 남기고 메모리에서 바로 Drive로 스트리밍한다(로컬 서버에 잔여 파일이 없음).
const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter
});

function mapUploadError(err) {
  if (!err) return null;
  if (err.code === 'LIMIT_FILE_SIZE') return 'FILE_TOO_LARGE';
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') return 'TOO_MANY_FILES';
  if (err.message === 'UNSUPPORTED_FILE_TYPE') return 'UNSUPPORTED_FILE_TYPE';
  return 'UPLOAD_FAILED';
}

// multer 에러(확장자 거부/용량 초과 등)는 기본적으로 Express 전역 에러 핸들러로 흘러가면
// status 없는 500으로 떨어진다. 라우트에서 항상 400으로 명확히 응답하도록 감싼다.
function uploadSingle(fieldName) {
  return (req, res, next) => {
    multerInstance.single(fieldName)(req, res, (err) => {
      if (err) return res.status(400).json({ ok: false, error: mapUploadError(err) });
      next();
    });
  };
}

function uploadArray(fieldName, maxCount) {
  return (req, res, next) => {
    multerInstance.array(fieldName, maxCount)(req, res, (err) => {
      if (err) return res.status(400).json({ ok: false, error: mapUploadError(err) });
      next();
    });
  };
}

module.exports = { uploadSingle, uploadArray, MAX_FILE_SIZE_BYTES, ALLOWED_EXT };
