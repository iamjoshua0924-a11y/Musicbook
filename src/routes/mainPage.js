const express = require('express');
const Setting = require('../models/Setting');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const KEYS = {
  titleImage: 'titleImage',
  bannerImage: 'bannerImage',
  notice: 'notice',
  discordUrl: 'discordUrl',
  youtubeUrl: 'youtubeUrl',
  chzzkUrl: 'chzzkUrl'
};

async function getMany(keys) {
  const docs = await Setting.find({ key: { $in: keys } }).lean();
  const map = {};
  docs.forEach((d) => {
    map[d.key] = d.value;
  });
  return map;
}

router.get('/main', async (req, res) => {
  const m = await getMany(Object.values(KEYS));
  res.json({
    ok: true,
    data: {
      titleImage: m[KEYS.titleImage] || '',
      bannerImage: m[KEYS.bannerImage] || '',
      notice: m[KEYS.notice] || '',
      discordUrl: m[KEYS.discordUrl] || '',
      youtubeUrl: m[KEYS.youtubeUrl] || '',
      chzzkUrl: m[KEYS.chzzkUrl] || ''
    }
  });
});

router.patch('/main', requireAdmin, async (req, res) => {
  const { field, value } = req.body || {};
  if (!Object.values(KEYS).includes(field)) {
    return res.status(400).json({ ok: false, error: 'BAD_FIELD' });
  }
  await Setting.findOneAndUpdate(
    { key: field },
    { $set: { key: field, value: String(value || '') } },
    { upsert: true }
  );
  res.json({ ok: true });
});

module.exports = router;

