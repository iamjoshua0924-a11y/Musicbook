const mongoose = require('mongoose');

const SongSchema = new mongoose.Schema(
  {
    title: { type: String, required: true }, // 곡 제목(원문)
    displayTitle: { type: String, default: '' }, // 표시 곡명
    artist: { type: String, default: '' },
    key: { type: String, default: '' },
    genre: { type: String, default: '' },
    mood: { type: String, default: '' },
    vocal: { type: String, default: '' },

    googleFileId: { type: String, required: true, unique: true, index: true },
    driveUrl: { type: String, default: '' },
    folderPath: { type: String, default: '' },
    parseError: { type: String, default: '' },

    isLatest: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },

    searchText: { type: String, default: '', index: true },
    driveModifiedTime: { type: Date, default: null },

    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() }
  },
  { minimize: false }
);

SongSchema.pre('save', function preSave(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Song', SongSchema);
