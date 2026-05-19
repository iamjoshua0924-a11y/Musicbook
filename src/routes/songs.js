const express = require('express');
const Song = require('../models/Song');
const { requireSessionOrAdmin } = require('../middleware/auth');

const router = express.Router();

// Public read: viewer/main can list songs
router.get('/songs', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const genre = String(req.query.genre || '').trim();
  const mood = String(req.query.mood || '').trim();
  const vocal = String(req.query.vocal || '').trim();
  const latestOnly = String(req.query.latestOnly || '') === '1';

  const page = Math.max(1, Number(req.query.page || 1));
  // UI 이식 단계에서는 “전체 목록을 한번에 받아서 클라이언트에서 필터/페이징”을 하는 경우가 많아 상한을 넉넉히 둠
  const limit = Math.min(5000, Math.max(10, Number(req.query.limit || 100)));
  const skip = (page - 1) * limit;

  const filter = { hidden: { $ne: true } };
  if (q) filter.searchText = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
  if (genre) filter.genre = genre;
  if (mood) filter.mood = mood;
  if (vocal) filter.vocal = vocal;
  if (latestOnly) filter.isLatest = true;

  const [items, total] = await Promise.all([
    Song.find(filter).sort({ isLatest: -1, title: 1 }).skip(skip).limit(limit).lean(),
    Song.countDocuments(filter)
  ]);

  res.json({ ok: true, items, total, page, limit });
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
