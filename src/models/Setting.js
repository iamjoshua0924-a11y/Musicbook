const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: String, default: '' },
    updatedAt: { type: Date, default: () => new Date() }
  },
  { minimize: false }
);

SettingSchema.pre('save', function preSave(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Setting', SettingSchema);

