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

function shouldCompactBlocks(blocks) {
  // Object-per-cell blocks는 Mongo 16MB 제한을 쉽게 초과한다.
  // 대략 5만 셀 이상이면 compact 저장을 우선 시도한다.
  return Array.isArray(blocks) && blocks.length > 50_000;
}

function rleEncodeSpaces(str) {
  const s = String(str || '');
  /** @type {Array<[0,number] | [1,string]>} */
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') {
      let j = i + 1;
      while (j < s.length && s[j] === ' ') j += 1;
      out.push([0, j - i]);
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < s.length && s[j] !== ' ') j += 1;
    out.push([1, s.slice(i, j)]);
    i = j;
  }
  return out;
}

function compactBlocksV2(blocks) {
  /** @type {Array<{rawRle:any[], krRle:any[], chords:Array<{col:number, token:string}>}>} */
  const lines = [];
  let raw = '';
  let kr = '';
  /** @type {Array<{col:number, token:string}>} */
  let chords = [];
  let col = 0;

  const flush = () => {
    lines.push({ rawRle: rleEncodeSpaces(raw), krRle: rleEncodeSpaces(kr), chords });
    raw = '';
    kr = '';
    chords = [];
    col = 0;
  };

  for (const b of blocks || []) {
    if ((b?.lyric_raw ?? '') === '\n') {
      flush();
      continue;
    }
    const chord = String(b?.chord || '');
    const rawCh = String(b?.lyric_raw ?? ' ');
    const krCh = String(b?.lyric_kr ?? rawCh);
    if (chord) chords.push({ col, token: chord });
    raw += rawCh;
    kr += krCh;
    col += 1;
  }
  if (raw.length || kr.length || chords.length) flush();
  return { format: 'mb_chord_compact_v2', colUnit: 'cell', widePad: true, lines };
}

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
          setTempDoc(String(existing._id), { meta: existing.meta || {}, blocks: existing.blocks || [] }, 2 * 60 * 60 * 1000); // 2h
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
        ChordDoc.create({ _id: docId, meta, blocks: toStore }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB_WRITE_TIMEOUT')), 2500))
      ]);
    } catch (e) {
      const msg = String(e?.message || e);
      return res.status(503).json({ ok: false, error: msg === 'DB_WRITE_TIMEOUT' ? 'STORE_TIMEOUT' : 'STORE_FAILED' });
    }

    // memory cache (옵션)
    setTempDoc(docId, { meta, blocks: toStore }, 2 * 60 * 60 * 1000); // 2h

    return res.json({
      ok: true,
      docId,
      meta,
      blocksCount: Array.isArray(blocksRaw) ? blocksRaw.length : Array.isArray(toStore?.lines) ? toStore.lines.length : 0
    });
  })
);

module.exports = router;
