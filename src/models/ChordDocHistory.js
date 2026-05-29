const mongoose = require('mongoose');

// 코드뷰어 편집 이력 (최대 10개, doc TTL과 동일하게 30일 보관)
// - _id를 docId로 사용
// - items는 오래된 순으로 쌓이고, 조회 시에는 최신순으로 반환

const ItemSchema = new mongoose.Schema(
  {
    savedAt: { type: Number, required: true }, // epoch ms
    savedBy: { type: String, default: '' },
    source: { type: String, default: 'edit' }, // edit | rollback_before | rollback
    rawText: { type: String, default: '' }
  },
  { _id: false, versionKey: false }
);

const ChordDocHistorySchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // docId
    items: { type: [ItemSchema], default: [] },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }
  },
  { versionKey: false }
);

module.exports = mongoose.models.ChordDocHistory || mongoose.model('ChordDocHistory', ChordDocHistorySchema);

