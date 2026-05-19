const express = require('express');
const router = express.Router();

router.get('/health', async (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

module.exports = router;

