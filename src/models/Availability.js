const mongoose = require('mongoose');

/**
 * Availability (가능곡)
 * - sheet 모델을 단순화해서 googleFileId + userId 조합으로 관리
 * - session/admin 전용 편집(일반 viewer는 읽기만)
 */
const AvailabilitySchema = new mongoose.Schema(
  {
    googleFileId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    available: { type: Boolean, required: true, default: true },
    // 개인 노래책 숙련도: 0(미설정) / 1(더듬더듬) / 2(보통) / 3(잘할수있음)
    proficiency: { type: Number, required: true, default: 0, min: 0, max: 3 },
    updatedAt: { type: Date, default: () => new Date() }
  },
  { minimize: false }
);

AvailabilitySchema.index({ googleFileId: 1, userId: 1 }, { unique: true });

AvailabilitySchema.pre('save', function preSave(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Availability', AvailabilitySchema);
