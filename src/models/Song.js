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
    legacySongId: { type: String, default: '', index: true }, // GAS 시트의 "곡 ID"(UUID)
    driveUrl: { type: String, default: '' },
    folderPath: { type: String, default: '' },
    parseError: { type: String, default: '' },

    isLatest: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
    // DS-07: 관리자가 수동으로 숨김/노출을 지정한 곡 표시.
    // true면 driveSync가 파일명 패턴으로 hidden을 재계산하지 않고 현재 값을 보존한다.
    hiddenManual: { type: Boolean, default: false },

    // 악보 없는 곡 / 개인 전용 곡(다음 phase의 "가능곡 추가 UI"에서 채워짐).
    // googleFileId는 required+unique 제약을 그대로 유지하므로, 이런 문서는
    // src/services/placeholderSong.js의 헬퍼로 만든 합성 ID(`local-<uuid>`)를 googleFileId에 넣는다.
    hasScoreFile: { type: Boolean, default: true },
    externalLink: { type: String, default: '' }, // 코드위키 등 외부 링크
    scope: { type: String, enum: ['global', 'private'], default: 'global', index: true },
    privateOwnerId: { type: String, default: '', index: true },

    searchText: { type: String, default: '', index: true },
    driveModifiedTime: { type: Date, default: null },
    syncRootId: { type: String, default: '', index: true },
    lastSeenAt: { type: Date, default: null, index: true },

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
