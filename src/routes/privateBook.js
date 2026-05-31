const express = require('express');
const User = require('../models/User');
const { requireLogin } = require('../middleware/auth');
const { driveToThumb } = require('../services/legacyCsvImport');

const router = express.Router();

// Public: 개인 노래책 공개 프로필(stealth 계정만)
router.get('/private-book/:userId', async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const user = await User.findOne({ userId, active: { $ne: false }, isPrivate: true }).lean();
  if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  res.json({
    ok: true,
    user: {
      userId: user.userId,
      displayName: user.displayName || user.userId,
      profilePhoto: user.profilePhoto || '',
      titleImage: user.privateTitleImage || ''
    }
  });
});

// Private(로그인): 본인 개인 노래책 설정 저장(stealth 계정만)
router.patch('/private-book', requireLogin, async (req, res) => {
  const titleImage = String(req.body?.titleImage || '').trim();
  const user = await User.findById(req.session.user.id);
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  if (!user.isPrivate) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  // Drive 링크(/view 등)도 받을 수 있게 thumbnail로 저장
  user.privateTitleImage = titleImage ? driveToThumb(titleImage, 1200) : '';
  user.updatedAt = new Date();
  await user.save();

  res.json({ ok: true, titleImage: user.privateTitleImage || '' });
});

module.exports = router;

