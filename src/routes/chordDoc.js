const express = require('express');
const { z } = require('zod');

const ChordDoc = require('../models/ChordDoc');
const { getTempDoc } = require('../services/chordDocTempStore');

const router = express.Router();

const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((err) => next(err));

// GET /api/chord-doc?docId=...
router.get(
  '/chord-doc',
  asyncHandler(async (req, res) => {
  const schema = z.object({ docId: z.string().min(1).max(200) });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const docId = String(parsed.data.docId);
  // 메모리 임시 저장소를 1순위로 조회(502/DB 장애 시에도 chord 문서 열기 보장)
  const v = getTempDoc(docId);
  if (v) return res.json({ ok: true, docId, meta: v.meta || {}, blocks: v.blocks || [] });
  try {
    const doc = await Promise.race([
      ChordDoc.findById(docId).lean(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MONGO_READ_TIMEOUT')), 2500))
    ]);
    if (!doc) return res.status(404).json({ ok: false, error: 'DOC_NOT_FOUND' });
    return res.json({ ok: true, docId, meta: doc.meta || {}, blocks: doc.blocks || [] });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg === 'MONGO_READ_TIMEOUT') return res.status(504).json({ ok: false, error: 'DOC_LOAD_TIMEOUT' });
    return res.status(502).json({ ok: false, error: 'DOC_LOAD_FAILED' });
  }
  })
);

module.exports = router;
