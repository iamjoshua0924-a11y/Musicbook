const express = require('express');
const Song = require('../models/Song');
const User = require('../models/User');
const { requireLogin } = require('../middleware/auth');
const { hasPublicBook } = require('../services/bookAccess');
const { generatePlaceholderGoogleFileId } = require('../services/placeholderSong');
const { bulkUpsertAvailability } = require('../services/availabilityBulk');

const router = express.Router();

// 한 번에 너무 많은 문서를 만들지 않게 하는 안전장치(스펙엔 없지만 사고 방지용 상한).
const MAX_ROWS = 500;

// Private(로그인): 개인 노래책 "가능곡 편집"에서 악보 없음/외부링크 placeholder 곡을 벌크로 추가.
// :userId 파라미터를 받지 않고 항상 req.session.user 기준으로만 동작한다 —
// 다른 사람의 개인 노래책에 잘못 추가되는 사고를 원천 차단하기 위함.
router.post('/private-book/available-songs/bulk', requireLogin, async (req, res) => {
  const user = await User.findById(req.session.user.id);
  if (!user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  if (!hasPublicBook(user)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawItems.length) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  if (rawItems.length > MAX_ROWS) return res.status(400).json({ ok: false, error: 'TOO_MANY_ROWS', max: MAX_ROWS });

  const created = [];
  const failed = [];

  // 순차 처리: placeholder googleFileId는 매번 새 UUID라 충돌 걱정은 없지만,
  // 벌크 입력 특성상 몇십 건 수준이라 순차로도 충분히 빠르고 오류 대응이 단순하다.
  for (const [idx, row] of rawItems.entries()) {
    const title = String(row?.title || '').trim();
    const artist = String(row?.artist || '').trim();
    const externalLink = String(row?.externalLink || '').trim();
    const genre = String(row?.genre || '').trim();

    if (!title) {
      failed.push({ row: idx, reason: 'TITLE_REQUIRED' });
      continue;
    }
    if (!artist) {
      failed.push({ row: idx, reason: 'ARTIST_REQUIRED' });
      continue;
    }

    try {
      const googleFileId = generatePlaceholderGoogleFileId();
      const searchText = `${title} ${artist} ${genre}`.toLowerCase().trim();
      // eslint-disable-next-line no-await-in-loop
      const doc = await Song.create({
        googleFileId,
        title,
        displayTitle: title,
        artist,
        genre,
        externalLink,
        hasScoreFile: false,
        scope: 'private',
        privateOwnerId: user.userId,
        searchText
      });
      created.push({
        row: idx,
        songId: String(doc._id),
        googleFileId,
        title,
        artist,
        genre,
        externalLink,
        hasScoreFile: false
      });
    } catch (e) {
      failed.push({ row: idx, reason: String(e?.message || 'CREATE_FAILED') });
    }
  }

  // 새로 만든 곡들을 요청자 본인의 가능곡으로 표시. 기존 Availability 벌크 upsert를 그대로 재사용한다.
  if (created.length) {
    await bulkUpsertAvailability(
      user.userId,
      created.map((c) => ({ googleFileId: c.googleFileId, available: true }))
    );
  }

  res.json({ ok: true, created, failed });
});

module.exports = router;
