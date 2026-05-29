const express = require('express');
const { z } = require('zod');

const ChordDoc = require('../models/ChordDoc');
const ChordDocHistory = require('../models/ChordDocHistory');
const { getTempDoc } = require('../services/chordDocTempStore');
const { parseRawTextToBlocks } = require('../services/chordParser');

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
  if (v) return res.json({ ok: true, docId, meta: v.meta || {}, blocks: v.blocks || [], rawText: String(v.rawText || '') });
  try {
    const doc = await Promise.race([
      ChordDoc.findById(docId).lean(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MONGO_READ_TIMEOUT')), 2500))
    ]);
    if (!doc) return res.status(404).json({ ok: false, error: 'DOC_NOT_FOUND' });
    return res.json({ ok: true, docId, meta: doc.meta || {}, blocks: doc.blocks || [], rawText: String(doc.rawText || '') });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg === 'MONGO_READ_TIMEOUT') return res.status(504).json({ ok: false, error: 'DOC_LOAD_TIMEOUT' });
    return res.status(502).json({ ok: false, error: 'DOC_LOAD_FAILED' });
  }
  })
);

// GET /api/chord-doc/history?docId=...
router.get(
  '/chord-doc/history',
  asyncHandler(async (req, res) => {
    const role = req.session?.user?.role;
    if (role !== 'admin' && role !== 'session') return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    const schema = z.object({ docId: z.string().min(1).max(200) });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
    const docId = String(parsed.data.docId);
    const h = await ChordDocHistory.findById(docId).lean();
    const items = Array.isArray(h?.items) ? h.items : [];
    const out = items
      .slice()
      .sort((a, b) => Number(b?.savedAt || 0) - Number(a?.savedAt || 0))
      .slice(0, 10)
      .map((it) => {
        const raw = String(it?.rawText || '');
        const firstLine = raw.split('\n')[0] || '';
        return {
          savedAt: Number(it?.savedAt || 0),
          savedBy: String(it?.savedBy || ''),
          source: String(it?.source || 'edit'),
          preview: firstLine.slice(0, 80),
          length: raw.length
        };
      });
    return res.json({ ok: true, docId, items: out });
  })
);

// POST /api/chord-doc/rollback {docId, savedAt}
router.post(
  '/chord-doc/rollback',
  asyncHandler(async (req, res) => {
    const role = req.session?.user?.role;
    if (role !== 'admin' && role !== 'session') return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

    const schema = z
      .object({
        docId: z.string().min(1).max(200),
        savedAt: z.coerce.number().int().min(1)
      })
      .strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

    const docId = String(parsed.data.docId);
    const targetSavedAt = Number(parsed.data.savedAt);

    const [doc, hist] = await Promise.all([ChordDoc.findById(docId).lean(), ChordDocHistory.findById(docId).lean()]);
    if (!doc) return res.status(404).json({ ok: false, error: 'DOC_NOT_FOUND' });
    const items = Array.isArray(hist?.items) ? hist.items : [];
    const target = items.find((x) => Number(x?.savedAt || 0) === targetSavedAt);
    if (!target?.rawText) return res.status(404).json({ ok: false, error: 'HISTORY_NOT_FOUND' });

    // push current doc rawText to history before rollback (so rollback itself is undoable)
    const nowMs = Date.now();
    const userId = String(req.session?.user?.userId || '');
    const currentRaw = String(doc?.rawText || '');
    if (currentRaw.trim()) {
      await ChordDocHistory.findOneAndUpdate(
        { _id: docId },
        {
          $push: {
            items: {
              $each: [{ savedAt: nowMs, savedBy: userId || 'member', source: 'rollback_before', rawText: currentRaw }],
              $slice: -10
            }
          },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
      );
    }

    // apply rollback
    const baseRawText = String(target.rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocksRaw = await parseRawTextToBlocks(baseRawText);
    const toStore = shouldCompactBlocks(blocksRaw) ? compactBlocksV2(blocksRaw) : blocksRaw;
    const meta = {
      ...(doc.meta || {}),
      editedAt: new Date().toISOString(),
      editedBy: userId || 'member',
      source: 'rollback',
      rollbackFrom: targetSavedAt
    };
    await ChordDoc.updateOne({ _id: docId }, { $set: { blocks: toStore, rawText: baseRawText, meta, createdAt: new Date() } });

    // cache refresh (best effort)
    try {
      const { setTempDoc } = require('../services/chordDocTempStore');
      setTempDoc(docId, { meta, blocks: toStore, rawText: baseRawText }, 2 * 60 * 60 * 1000);
    } catch {}

    return res.json({ ok: true, docId, rolledBackTo: targetSavedAt, meta });
  })
);

// POST /api/chord-doc/reset {docId}
// - 편집본/롤백본을 "최초 상태"로 되돌리고, 이력도 제거한다.
router.post(
  '/chord-doc/reset',
  asyncHandler(async (req, res) => {
    const role = req.session?.user?.role;
    if (role !== 'admin' && role !== 'session') return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

    const schema = z
      .object({
        docId: z.string().min(1).max(200)
      })
      .strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

    const docId = String(parsed.data.docId);
    const [doc, hist] = await Promise.all([ChordDoc.findById(docId).lean(), ChordDocHistory.findById(docId).lean()]);
    if (!doc) return res.status(404).json({ ok: false, error: 'DOC_NOT_FOUND' });

    const items = Array.isArray(hist?.items) ? hist.items : [];
    if (!items.length) return res.status(409).json({ ok: false, error: 'NO_HISTORY' });

    // 가장 오래된 rawText를 "원본"으로 간주(첫 편집 직전 버전)
    const oldest = items.slice().sort((a, b) => Number(a?.savedAt || 0) - Number(b?.savedAt || 0))[0];
    const rawText = String(oldest?.rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!rawText.trim()) return res.status(409).json({ ok: false, error: 'EMPTY_ORIGINAL' });

    const blocksRaw = await parseRawTextToBlocks(rawText);
    const toStore = shouldCompactBlocks(blocksRaw) ? compactBlocksV2(blocksRaw) : blocksRaw;
    const userId = String(req.session?.user?.userId || '');
    const meta = {
      ...(doc.meta || {}),
      editedAt: new Date().toISOString(),
      editedBy: userId || 'member',
      source: 'reset',
      resetFrom: Number(oldest?.savedAt || 0)
    };

    await Promise.all([
      ChordDoc.updateOne({ _id: docId }, { $set: { blocks: toStore, rawText, meta, createdAt: new Date() } }),
      ChordDocHistory.deleteOne({ _id: docId })
    ]);

    // cache refresh (best effort)
    try {
      const { setTempDoc } = require('../services/chordDocTempStore');
      setTempDoc(docId, { meta, blocks: toStore, rawText }, 2 * 60 * 60 * 1000);
    } catch {}

    return res.json({ ok: true, docId, meta });
  })
);

// GET /api/chord-doc/list?q=&page=&limit=
router.get(
  '/chord-doc/list',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      q: z.string().max(200).optional().default(''),
      page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
      limit: z.coerce.number().int().min(1).max(50).optional().default(30)
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

    const q = String(parsed.data.q || '').trim();
    const page = Number(parsed.data.page || 1);
    const limit = Number(parsed.data.limit || 30);
    const skip = (page - 1) * limit;

    /** @type {any} */
    const cond = {};
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      cond.$or = [{ _id: rx }, { 'meta.sourceUrl': rx }, { 'meta.editedBy': rx }, { 'meta.source': rx }];
    }

    // count + list
    const [total, docs] = await Promise.all([
      ChordDoc.countDocuments(cond),
      ChordDoc.find(cond, { _id: 1, meta: 1, createdAt: 1 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    return res.json({
      ok: true,
      q,
      page,
      limit,
      total,
      items: (docs || []).map((d) => ({
        docId: String(d._id),
        createdAt: d.createdAt,
        meta: d.meta || {}
      }))
    });
  })
);

function shouldCompactBlocks(blocks) {
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

// PUT /api/chord-doc  (page-turner/admin edit)
router.put(
  '/chord-doc',
  asyncHandler(async (req, res) => {
    const role = req.session?.user?.role;
    if (role !== 'admin' && role !== 'session') return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });

    const schema = z
      .object({
        docId: z.string().min(1).max(200),
        rawText: z.string().min(1).max(500_000)
      })
      .strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

    const docId = String(parsed.data.docId);
    const existing = await ChordDoc.findById(docId).lean();
    if (!existing) return res.status(404).json({ ok: false, error: 'DOC_NOT_FOUND' });

    // T-08: history snapshot (best effort)
    try {
      const prevRaw = String(existing?.rawText || '').trim();
      if (prevRaw) {
        const prevSavedAt = (() => {
          const t = String(existing?.meta?.editedAt || existing?.createdAt || '');
          const ms = t ? new Date(t).getTime() : 0;
          return Number.isFinite(ms) && ms > 0 ? ms : Date.now();
        })();
        const prevSavedBy = String(existing?.meta?.editedBy || '');
        await ChordDocHistory.findOneAndUpdate(
          { _id: docId },
          {
            $push: {
              items: {
                $each: [{ savedAt: prevSavedAt, savedBy: prevSavedBy, source: 'edit', rawText: prevRaw }],
                $slice: -10
              }
            },
            $setOnInsert: { createdAt: new Date() }
          },
          { upsert: true }
        );
      }
    } catch {}

    const rawText = String(parsed.data.rawText || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // 줄 끝 공백은 편집/렌더 반복 시 폭발하기 쉬워서 제거(정렬은 내부 공백으로 충분)
      .split('\n')
      .map((ln) => ln.replace(/[ \t]+$/g, ''))
      .join('\n');

    const blocksRaw = await parseRawTextToBlocks(rawText);
    const toStore = shouldCompactBlocks(blocksRaw) ? compactBlocksV2(blocksRaw) : blocksRaw;
    const userId = String(req.session?.user?.userId || '');
    const meta = {
      ...(existing.meta || {}),
      editedAt: new Date().toISOString(),
      editedBy: userId || 'member',
      source: 'manualEdit'
    };

    await ChordDoc.updateOne(
      { _id: docId },
      { $set: { blocks: toStore, rawText, meta, createdAt: new Date() } },
      { upsert: false }
    );

    // cache refresh (best effort)
    try {
      const { setTempDoc } = require('../services/chordDocTempStore');
      setTempDoc(docId, { meta, blocks: toStore, rawText }, 2 * 60 * 60 * 1000);
    } catch {}

    return res.json({ ok: true, docId, meta, blocksCount: Array.isArray(blocksRaw) ? blocksRaw.length : 0 });
  })
);

module.exports = router;
