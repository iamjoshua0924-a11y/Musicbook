const mongoose = require('mongoose');

// 코드위키(Chord) 문서 저장소 (TTL)
// - docId를 viewer의 fileId로도 사용하기 위해 _id를 string으로 둔다.
// - createdAt에 TTL을 걸어 일정 기간 뒤 자동 삭제된다.

const ChordDocSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // docId
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    blocks: { type: mongoose.Schema.Types.Mixed, default: [] },
    // 30일 보관 (코드위키 목록/재사용 UX 개선)
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }
  },
  { versionKey: false }
);

module.exports = mongoose.models.ChordDoc || mongoose.model('ChordDoc', ChordDocSchema);
