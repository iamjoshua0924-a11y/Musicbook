const express = require('express');
const User = require('../models/User');
const { requireLogin } = require('../middleware/auth');
const { driveToThumb } = require('../services/legacyCsvImport');
const { hasPublicBook, buildPublicBookUserQuery } = require('../services/bookAccess');

const router = express.Router();
const PRIVATE_THEMES = new Set([
  'pink',
  'dark',
  'sky',
  'green',
  'amber',
  'lavender',
  'midnight',
  'rosebeige',
  'mint',
  'coral',
  'mocha',
  'custom'
]);

function clampText(v, max) {
  return String(v || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeHex(v, fallback) {
  const s = String(v || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return String(fallback || '').trim() || '#000000';
}

// Public: 개인 노래책 공개 프로필(private 또는 공개 노래책 활성 유저)
router.get('/private-book/:userId', async (req, res) => {
  const userId = String(req.params?.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const user = await User.findOne(buildPublicBookUserQuery(userId)).lean();
  if (!user) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  res.json({
    ok: true,
    user: {
      userId: user.userId,
      displayName: user.displayName || user.userId,
      profilePhoto: user.profilePhoto || '',
      titleImage: user.privateTitleImage || '',
      theme: PRIVATE_THEMES.has(String(user.privateTheme || '')) ? String(user.privateTheme) : 'pink',
      customA: normalizeHex(user.privateThemeCustomA, '#f2f3ff'),
      customB: normalizeHex(user.privateThemeCustomB, '#ffffff'),
      customC: normalizeHex(user.privateThemeCustomC, '#6b5bff'),
      statusTitle: user.privateStatusTitle || '',
      statusDesc: user.privateStatusDesc || '',
      reviewEnabled: Boolean(user.privateReviewEnabled)
    }
  });
});

// Private(로그인): 본인 개인 노래책 설정 저장(private 또는 공개 노래책 활성 유저)
router.patch('/private-book', requireLogin, async (req, res) => {
  const hasTitleImage = req.body?.titleImage !== undefined;
  const hasTheme = req.body?.theme !== undefined;
  const hasCustomA = req.body?.customA !== undefined;
  const hasCustomB = req.body?.customB !== undefined;
  const hasCustomC = req.body?.customC !== undefined;
  const hasStatusTitle = req.body?.statusTitle !== undefined;
  const hasStatusDesc = req.body?.statusDesc !== undefined;
  const hasReviewEnabled = req.body?.reviewEnabled !== undefined;
  const titleImage = String(req.body?.titleImage || '').trim();
  const theme = String(req.body?.theme || '').trim().toLowerCase();
  const statusTitle = clampText(req.body?.statusTitle, 80);
  const statusDesc = clampText(req.body?.statusDesc, 220);
  const reviewEnabled = Boolean(req.body?.reviewEnabled);
  const user = await User.findById(req.session.user.id);
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  if (!hasPublicBook(user)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
  const customA = normalizeHex(req.body?.customA, user.privateThemeCustomA || '#f2f3ff');
  const customB = normalizeHex(req.body?.customB, user.privateThemeCustomB || '#ffffff');
  const customC = normalizeHex(req.body?.customC, user.privateThemeCustomC || '#6b5bff');

  // Drive 링크(/view 등)도 받을 수 있게 thumbnail로 저장
  if (hasTitleImage) user.privateTitleImage = titleImage ? driveToThumb(titleImage, 1200) : '';
  if (hasTheme) {
    if (!PRIVATE_THEMES.has(theme)) return res.status(400).json({ ok: false, error: 'BAD_THEME' });
    user.privateTheme = theme;
  }
  // custom colors are stored even if theme is not custom (so switching is instant)
  if (hasCustomA) user.privateThemeCustomA = normalizeHex(customA, user.privateThemeCustomA);
  if (hasCustomB) user.privateThemeCustomB = normalizeHex(customB, user.privateThemeCustomB);
  if (hasCustomC) user.privateThemeCustomC = normalizeHex(customC, user.privateThemeCustomC);
  if (hasStatusTitle) user.privateStatusTitle = statusTitle;
  if (hasStatusDesc) user.privateStatusDesc = statusDesc;
  if (hasReviewEnabled) user.privateReviewEnabled = reviewEnabled;
  user.updatedAt = new Date();
  await user.save();

  res.json({
    ok: true,
    titleImage: user.privateTitleImage || '',
    theme: PRIVATE_THEMES.has(String(user.privateTheme || '')) ? String(user.privateTheme) : 'pink',
    customA: normalizeHex(user.privateThemeCustomA, '#f2f3ff'),
    customB: normalizeHex(user.privateThemeCustomB, '#ffffff'),
    customC: normalizeHex(user.privateThemeCustomC, '#6b5bff'),
    statusTitle: user.privateStatusTitle || '',
    statusDesc: user.privateStatusDesc || '',
    reviewEnabled: Boolean(user.privateReviewEnabled)
  });
});

module.exports = router;
