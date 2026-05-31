const express = require('express');
const { getPrivateArchivePrefix } = require('../services/privateArchive');

const router = express.Router();

// Public: 개인 아카이브 prefix 조회(정적 호스팅 딥링크/라우팅용)
router.get('/private-archive', async (_req, res) => {
  const prefix = await getPrivateArchivePrefix();
  res.json({ ok: true, prefix });
});

module.exports = router;

