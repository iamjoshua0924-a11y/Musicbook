const mongoose = require('mongoose');

// 코드위키(Chord) 문서 임시 저장소 (24h TTL)
// - docId를 viewer의 fileId로도 사용하기 위해 _id를 string으로 둔다.
// - createdAt에 TTL을 걸어 24시간 뒤 자동 삭제된다.

const ChordDocSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // docId
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    blocks: { type: mongoose.Schema.Types.Mixed, default: [] },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 }
  },
  { versionKey: false }
);

module.exports = mongoose.models.ChordDoc || mongoose.model('ChordDoc', ChordDocSchema);

