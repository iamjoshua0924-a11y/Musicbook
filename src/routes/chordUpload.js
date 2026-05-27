const express = require('express');
const { z } = require('zod');
const { nanoid } = require('nanoid');

const { parseRawTextToBlocks } = require('../services/chordParser');
const { setTempDoc } = require('../services/chordDocTempStore');
const ChordDoc = require('../models/ChordDoc');

const router = express.Router();

const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((err) => next(err));

// POST /api/chord/upload
// - proxyChord(크롤/puppeteer/DB) 경로를 거치지 않고,
//   rawText를 받아 바로 temp(in-memory)에 저장 후 docId만 반환한다.
// - 목적: Render 502/DB 이슈와 무관하게 "docId 발급"을 안정화
router.post(
  '/chord/upload',
  asyncHandler(async (req, res) => {
    const schema = z
      .object({
        rawText: z.string().min(1).max(500_000),
        sourceUrl: z.union([z.string().url(), z.literal('')]).optional()
      })
      .strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

    const rawText = parsed.data.rawText;
    const meta = { source: 'clientRawText', sourceUrl: parsed.data.sourceUrl || '' };
    const blocks = await parseRawTextToBlocks(rawText);

    const docId = `chord:${nanoid(12)}`;
    setTempDoc(docId, { meta, blocks }, 2 * 60 * 60 * 1000); // 2h

    // Cross-instance 대비: DB에도 best-effort로 저장한다.
    // - 단, DB가 느리면 여기서 기다리다 Render 502가 날 수 있으니 짧게만 기다리고 빠져나간다.
    const writePromise = ChordDoc.create({ _id: docId, meta, blocks }).catch(() => null);
    await Promise.race([writePromise, new Promise((resolve) => setTimeout(resolve, 900))]);

    return res.json({ ok: true, docId, meta, blocksCount: Array.isArray(blocks) ? blocks.length : 0 });
  })
);

module.exports = router;
