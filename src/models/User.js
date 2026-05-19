const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true }, // 로그인 ID
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'session'], required: true, index: true },
    displayName: { type: String, default: '' },
    active: { type: Boolean, default: true },
    profilePhoto: { type: String, default: '' },

    mustChangePassword: { type: Boolean, default: false },
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

