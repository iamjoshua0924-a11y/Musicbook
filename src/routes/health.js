const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const router = express.Router();

router.get('/health', asyncHandler(async (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
}));

module.exports = router;

