const express = require('express');
const Song = require('../models/Song');
const { requireSessionOrAdmin } = require('../middleware/auth');
const Availability = require('../models/Availability');

const router = express.Router();

function escRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Public read: viewer/main can list songs
router.get('/songs', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const genre = String(req.query.genre || '').trim();
  const mood = String(req.query.mood || '').trim();
  const vocal = String(req.query.vocal || '').trim();

  const page = Math.max(1, Number(req.query.page || 1));
  // UI 이식 단계에서는 “전체 목록을 한번에 받아서 클라이언트에서 필터/페이징”을 하는 경우가 많아 상한을 넉넉히 둠
  const limit = Math.min(5000, Math.max(10, Number(req.query.limit || 100)));
  const skip = (page - 1) * limit;

  const filter = { hidden: { $ne: true } };
  if (q) filter.searchText = { $regex: escRegex(q) };
  if (genre) filter.genre = genre;
  if (mood) filter.mood = mood;
  if (vocal) filter.vocal = vocal;

  const [items, total] = await Promise.all([
    Song.find(filter).sort({ isLatest: -1, title: 1 }).skip(skip).limit(limit).lean(),
    Song.countDocuments(filter)
  ]);

  res.json({ ok: true, items, total, page, limit });
});

/**
 * 카드 응답(조성 통합):
 * - title/artist 기준으로 카드 1개
 * - key만 다른 악보는 variants로 합침
 * - (title,artist,key)가 동일한 중복은 googleFileId 기준으로 "항상 동일하게" 1개만 남김
 */
router.get('/songs/cards', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const genre = String(req.query.genre || '').trim();
  const mood = String(req.query.mood || '').trim();
  const vocal = String(req.query.vocal || '').trim();
  const availableUserId = String(req.query.availableUserId || '').trim();

  const filter = { hidden: { $ne: true } };
  if (q) filter.searchText = { $regex: escRegex(q) };
  if (genre) filter.genre = genre;
  if (mood) filter.mood = mood;
  if (vocal) filter.vocal = vocal;

  let availSet = null;
  if (availableUserId) {
    const items = await Availability.find({ userId: availableUserId, available: true }).lean();
    availSet = new Set((items || []).map((x) => x.googleFileId));
  }

  const songs = await Song.find(filter).sort({ title: 1, artist: 1, key: 1, googleFileId: 1 }).limit(5000).lean();
  const cardsByKey = new Map(); // cardKey -> card

  for (const s of songs) {
    if (availSet && !availSet.has(s.googleFileId)) continue;

    const title = String(s.displayTitle || s.title || '').trim();
    const artist = String(s.artist || '').trim();
    const cardKey = `${title.toLowerCase()}||${artist.toLowerCase()}`;
    let card = cardsByKey.get(cardKey);
    if (!card) {
      card = {
        cardId: cardKey,
        title,
        artist,
        genre: s.genre || '',
        mood: s.mood || '',
        vocal: s.vocal || '',
        isLatest: Boolean(s.isLatest),
        variantsByKey: new Map()
      };
      cardsByKey.set(cardKey, card);
    } else {
      card.isLatest = card.isLatest || Boolean(s.isLatest);
    }

    const k = String(s.key || '').trim();
    const existing = card.variantsByKey.get(k);
    if (!existing || String(s.googleFileId) < String(existing.googleFileId)) {
      card.variantsByKey.set(k, {
        key: k,
        songId: String(s._id),
        googleFileId: s.googleFileId,
        driveUrl: s.driveUrl || ''
      });
    }
  }

  const cards = [];
  for (const card of cardsByKey.values()) {
    const variants = Array.from(card.variantsByKey.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const keys = variants.map((v) => v.key);
    const searchText = `${card.title} ${card.artist} ${card.genre} ${card.mood} ${card.vocal} ${keys.join(' ')}`.toLowerCase();
    cards.push({
      cardId: card.cardId,
      title: card.title,
      artist: card.artist,
      genre: card.genre,
      mood: card.mood,
      vocal: card.vocal,
      isLatest: card.isLatest,
      keys,
      variants,
      searchText
    });
  }

  res.json({ ok: true, items: cards, total: cards.length });
});

// Admin/session write (for later: sync or manual edits)
router.post('/songs', requireSessionOrAdmin, async (req, res) => {
  const body = req.body || {};
  const googleFileId = String(body.googleFileId || '').trim();
  const title = String(body.title || '').trim();
  if (!googleFileId || !title) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const searchText = `${title} ${body.displayTitle || ''} ${body.artist || ''}`.toLowerCase();
  const doc = await Song.findOneAndUpdate(
    { googleFileId },
    {
      $set: {
        title,
        displayTitle: String(body.displayTitle || ''),
        artist: String(body.artist || ''),
        key: String(body.key || ''),
        genre: String(body.genre || ''),
        mood: String(body.mood || ''),
        vocal: String(body.vocal || ''),
        driveUrl: String(body.driveUrl || ''),
        folderPath: String(body.folderPath || ''),
        isLatest: Boolean(body.isLatest),
        hidden: Boolean(body.hidden),
        searchText
      }
    },
    { upsert: true, new: true }
  );

  res.json({ ok: true, item: doc.toObject() });
});

module.exports = router;
