const express = require('express');
const { z } = require('zod');
const { nanoid } = require('nanoid');

const { asyncHandler } = require('../middleware/asyncHandler');
const { createRateLimiter } = require('../middleware/rateLimit');
// CHORD-3(2차 감사): 무인증 파서(CPU) 유발 경로 — IP당 분당 10회 제한
const chordUploadLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
const { parseRawTextToBlocks } = require('../services/chordParser');
const { setTempDoc } = require('../services/chordDocTempStore');
const ChordDoc = require('../models/ChordDoc');
const { shouldCompactBlocks, compactBlocksV2 } = require('../services/chordCompact');

const router = express.Router();

// POST /api/chord/upload
// - proxyChord(크롤/puppeteer/DB) 경로를 거치지 않고,
//   rawText를 받아 바로 temp(in-memory)에 저장 후 docId만 반환한다.
// - 목적: Render 502/DB 이슈와 무관하게 "docId 발급"을 안정화
router.post(
  '/chord/upload',
  chordUploadLimiter,
  asyncHandler(async (req, res) => {
    const schema = z
      .object({
        rawText: z.string().min(1).max(500_000),
        sourceUrl: z.union([z.string().url(), z.literal('')]).optional()
      })
      .strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

    const rawText = String(parsed.data.rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const sourceUrl = String(parsed.data.sourceUrl || '').trim();
    const meta = { source: 'clientRawText', sourceUrl };

    // 같은 링크가 다시 들어오면 기존 저장본을 재사용한다.
    // - 요청사항: 제목 자동인식/목록 UI 없이도 "같은 링크면 바로 열림" UX 제공
    if (sourceUrl) {
      try {
        const existing = await ChordDoc.findOne({ 'meta.sourceUrl': sourceUrl }).sort({ createdAt: -1 }).lean();
        if (existing?._id) {
          // TTL 연장(재사용된 문서는 더 오래 유지)
          try {
            await ChordDoc.updateOne({ _id: existing._id }, { $set: { createdAt: new Date() } });
          } catch {}
          // memory cache (옵션)
          setTempDoc(
            String(existing._id),
            { meta: existing.meta || {}, blocks: existing.blocks || [], rawText: String(existing.rawText || '') },
            2 * 60 * 60 * 1000
          ); // 2h
          return res.json({
            ok: true,
            docId: String(existing._id),
            meta: existing.meta || {},
            blocksCount: Array.isArray(existing.blocks) ? existing.blocks.length : Array.isArray(existing.blocks?.lines) ? existing.blocks.lines.length : 0,
            reused: true
          });
        }
      } catch {
        // reuse 실패 시 신규 생성으로 진행
      }
    }

    const blocksRaw = await parseRawTextToBlocks(rawText);

    const docId = `chord:${nanoid(12)}`;
    const toStore = shouldCompactBlocks(blocksRaw) ? compactBlocksV2(blocksRaw) : blocksRaw;

    // Mongo authoritative:
    // - DB 저장이 성공해야만 docId를 반환한다.
    // - 실패/타임아웃이면 ok:false로 반환(조회 불가능 docId 방출 금지)
    try {
      await Promise.race([
        ChordDoc.create({ _id: docId, meta, blocks: toStore, rawText }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB_WRITE_TIMEOUT')), 2500))
      ]);
    } catch (e) {
      const msg = String(e?.message || e);
      return res.status(503).json({ ok: false, error: msg === 'DB_WRITE_TIMEOUT' ? 'STORE_TIMEOUT' : 'STORE_FAILED' });
    }

    // memory cache (옵션)
    setTempDoc(docId, { meta, blocks: toStore, rawText }, 2 * 60 * 60 * 1000); // 2h

    return res.json({
      ok: true,
      docId,
      meta,
      blocksCount: Array.isArray(blocksRaw) ? blocksRaw.length : Array.isArray(toStore?.lines) ? toStore.lines.length : 0
    });
  })
);

module.exports = router;
