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
    // 개인 노래책 타이틀 배너(이미지)
    privateTitleImage: { type: String, default: '' },
    // 개인 노래책 전용 테마
    privateTheme: { type: String, enum: ['pink', 'dark', 'sky', 'green', 'amber'], default: 'pink' },
    // 개인 노래책 상태메세지 카드
    privateStatusTitle: { type: String, default: '' },
    privateStatusDesc: { type: String, default: '' },

    // 개인 노래책 "오늘의 셋리스트" (뷰어도 조회 가능 / 편집은 본인만)
    privateSetlistItems: {
      type: [
        {
          googleFileId: { type: String, default: '' },
          driveUrl: { type: String, default: '' },
          title: { type: String, default: '' },
          artist: { type: String, default: '' },
          tagText: { type: String, default: '' }, // 예: "C · 보통"
          done: { type: Boolean, default: false }
        }
      ],
      default: []
    },

    // 개인 노래책: 합주후기(코멘트) 기능
    privateReviewEnabled: { type: Boolean, default: false },
    privateReviewThreads: {
      type: [
        {
          cardId: { type: String, default: '' },
          title: { type: String, default: '' },
          artist: { type: String, default: '' },
          tagText: { type: String, default: '' },
          comments: {
            type: [
              {
                text: { type: String, default: '' }, // <= 30
                createdAt: { type: Date, default: () => new Date() }
              }
            ],
            default: []
          }
        }
      ],
      default: []
    },

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
