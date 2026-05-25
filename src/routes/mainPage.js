const express = require('express');
const Setting = require('../models/Setting');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function extractDriveFileId(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  const m1 = s.match(/\/file\/d\/([^/]+)\//);
  if (m1) return m1[1];
  const m2 = s.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  return '';
}

function driveToThumb(url, size = 800) {
  const id = extractDriveFileId(url);
  if (!id) return String(url || '').trim();
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${Number(size) || 800}`;
}

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
  let v = String(value || '').trim();
  // 이미지 필드는 Drive 공유 링크를 <img>에 바로 쓸 수 있게 thumbnail URL로 정규화한다.
  if (field === KEYS.bannerImage) v = driveToThumb(v, 1600);
  if (field === KEYS.titleImage) v = driveToThumb(v, 800);
  await Setting.findOneAndUpdate({ key: field }, { $set: { key: field, value: v } }, { upsert: true });
  res.json({ ok: true });
});

module.exports = router;
