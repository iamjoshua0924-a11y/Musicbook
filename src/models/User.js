const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true }, // 로그인 ID
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'session'], required: true, index: true },
    displayName: { type: String, default: '' },
    active: { type: Boolean, default: true },
    profilePhoto: { type: String, default: '' },

    // "스텔스/Private" 계정: 메인 접속자 목록/가능보컬 필터 목록에서 숨김 + 개인 아카이브 제공
    isPrivate: { type: Boolean, default: false, index: true },

    mustChangePassword: { type: Boolean, default: false },
    legacyPasswordHash: { type: String, default: '' }, // 기존 GAS 시트의 해시(참조용)
    lastSeenAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() }
  },
  { minimize: false }
);

UserSchema.pre('save', function preSave(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('User', UserSchema);
