const express = require('express');
const Song = require('../models/Song');
const { requireSessionOrAdmin } = require('../middleware/auth');
const Availability = require('../models/Availability');
const User = require('../models/User');

const router = express.Router();

// "(A#)","(Bb)","(Gm)" 같은 조성 표기(끝에 붙은 것만)
const KEY_SUFFIX_RE = /[（(]\s*([A-Ga-g])\s*([#b♯♭]?)\s*(m?)\s*[)）]\s*$/;

function escRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeKeySuffix(s) {
  const m = String(s || '').trim().match(KEY_SUFFIX_RE);
  if (!m) return { found: false, key: '', title: String(s || '').trim() };
  const letter = String(m[1] || '').toUpperCase();
  const acc = m[2] === '♭' ? 'b' : m[2] === '♯' ? '#' : String(m[2] || '');
  const minor = m[3] ? 'm' : '';
  const key = `${letter}${acc}${minor}`.trim();
  const title = String(s || '').replace(KEY_SUFFIX_RE, '').trim();
  return { found: Boolean(key), key, title };
}

// Public read: viewer/main can list songs
router.get('/songs', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const genre = String(req.query.genre || '').trim();
  const mood = String(req.query.mood || '').trim();
  const vocal = String(req.query.vocal || '').trim();

  const page = Math.max(1, Number(req.query.page || 1));
  // UI 이식 단계에서는 “전체 목록을 한번에 받아서 클라이언트에서 필터/페이징”을 하는 경우가 많아 상한을 넉넉히 둠
  const limit = Math.min(7000, Math.max(10, Number(req.query.limit || 100)));
  const skip = (page - 1) * limit;

  const filter = { hidden: { $ne: true } };
  if (q) filter.searchText = { $regex: escRegex(q) };
  if (genre) filter.genre = genre;
  if (mood) filter.mood = mood;
  if (vocal) filter.vocal = vocal;

  const [items0, total] = await Promise.all([
    Song.find(filter).sort({ isLatest: -1, title: 1 }).skip(skip).limit(limit).lean(),
    Song.countDocuments(filter)
  ]);

  // 기존 데이터 중 title에 "(조성)"이 붙어있는 케이스 자동 정리(점진적 self-heal)
  const ops = [];
  const items = items0.map((s) => {
    const baseTitle = String(s.displayTitle || s.title || '').trim();
    const t = normalizeKeySuffix(baseTitle);
    if (!t.found) return s;
    const currentKey = String(s.key || '').trim();
    const canAdopt = !currentKey || currentKey === t.key;
    if (!canAdopt) return s;
    const next = { ...s };
    // remove suffix from title/displayTitle (if existed)
    if (String(next.title || '').trim() === baseTitle) next.title = t.title;
    if (String(next.displayTitle || '').trim() === baseTitle) next.displayTitle = t.title;
    if (!currentKey) next.key = t.key;
    ops.push({
      updateOne: {
        filter: { _id: s._id },
        update: {
          $set: {
            title: next.title,
            displayTitle: next.displayTitle,
            key: next.key,
            searchText: `${next.displayTitle || ''} ${next.title || ''} ${next.artist || ''} ${next.genre || ''} ${next.mood || ''} ${next.vocal || ''} ${next.key || ''}`
              .toLowerCase()
              .trim()
          }
        }
      }
    });
    return next;
  });
  if (ops.length) Song.bulkWrite(ops, { ordered: false }).catch(() => {});

  res.json({ ok: true, items, total, page, limit });
});

/**
 * 카드 응답(조성 통합):
 * - title/artist 기준으로 카드 1개
 * - key만 다른 악보는 variants로 합침
 * - (title,artist,key)가 동일한 중복은 googleFileId 기준으로 "항상 동일하게" 1개만 남김
 */
router.get('/songs/cards', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const genre = String(req.query.genre || '').trim();
  const mood = String(req.query.mood || '').trim();
  const vocal = String(req.query.vocal || '').trim();
  const availableUserId = String(req.query.availableUserId || '').trim();

  const filter = { hidden: { $ne: true } };
  if (q) filter.searchText = { $regex: escRegex(q) };
  if (genre) filter.genre = genre;
  if (mood) filter.mood = mood;
  if (vocal) filter.vocal = vocal;

  let availSet = null;
  let availMap = null;
  if (availableUserId) {
    const items = await Availability.find({ userId: availableUserId, available: true }).lean();
    availMap = new Map((items || []).map((x) => [String(x.googleFileId || ''), x]));
    availSet = new Set(Array.from(availMap.keys()));
  }

  // IMPORTANT:
  // cards 응답은 UI에서 "전체 카드"를 메모리로 받아 클라이언트에서 필터/정렬/페이징을 하므로,
  // 여기서 Song.find에 낮은 limit을 걸면 "어느 날은 600개, 어느 날은 3000개"처럼 카드 수가 출렁일 수 있다.
  // (Drive 동기화/정규화로 정렬 순서가 바뀌면서, 상한(limit) 안에 포함되는 문서 집합이 계속 바뀌기 때문)
  // => 카드 생성용 원본 문서는 충분히 크게 받아온다.
  const MAX_DOCS_FOR_CARDS = 50_000;
  const [songs, totalDocs, totalCardsAgg] = await Promise.all([
    Song.find(filter).sort({ title: 1, artist: 1, key: 1, googleFileId: 1 }).limit(MAX_DOCS_FOR_CARDS).lean(),
    Song.countDocuments(filter),
    Song.aggregate([
      { $match: filter },
      {
        $project: {
          t: { $toLower: { $ifNull: ['$displayTitle', '$title'] } },
          a: { $toLower: { $ifNull: ['$artist', ''] } }
        }
      },
      { $group: { _id: { t: '$t', a: '$a' } } },
      { $count: 'n' }
    ]).allowDiskUse(true)
  ]);
  const totalCards = Number(totalCardsAgg?.[0]?.n || 0);
  const cardsByKey = new Map(); // cardKey -> card
  const fileIdToCardKey = new Map(); // googleFileId -> cardKey
  const fixOps = [];

  for (const s of songs) {
    if (availSet && !availSet.has(s.googleFileId)) continue;

    // self-heal: title 끝에 "(조성)"이 붙어있는 경우 key로 흡수하고 title에서 제거
    const baseTitle = String(s.displayTitle || s.title || '').trim();
    const t = normalizeKeySuffix(baseTitle);
    const currentKey = String(s.key || '').trim();
    const canAdopt = t.found && (!currentKey || currentKey === t.key);
    const title = canAdopt ? t.title : baseTitle;
    const key = canAdopt ? (currentKey || t.key) : currentKey;
    const artist = String(s.artist || '').trim();
    if (canAdopt) {
      const nextTitle = title;
      const nextDisplay = String(s.displayTitle || '').trim() === baseTitle ? nextTitle : s.displayTitle;
      fixOps.push({
        updateOne: {
          filter: { _id: s._id },
          update: {
            $set: {
              title: String(s.title || '').trim() === baseTitle ? nextTitle : s.title,
              displayTitle: nextDisplay,
              key,
              searchText: `${nextDisplay || ''} ${String(s.title || '').trim() === baseTitle ? nextTitle : (s.title || '')} ${artist} ${s.genre || ''} ${s.mood || ''} ${s.vocal || ''} ${key}`
                .toLowerCase()
                .trim()
            }
          }
        }
      });
    }
    const cardKey = `${title.toLowerCase()}||${artist.toLowerCase()}`;
    let card = cardsByKey.get(cardKey);
    if (!card) {
      card = {
        cardId: cardKey,
        title,
        artist,
        genre: s.genre || '',
        mood: s.mood || '',
        vocal: s.vocal || '',
        isLatest: Boolean(s.isLatest),
          latestModifiedMs: s.driveModifiedTime ? new Date(s.driveModifiedTime).getTime() : 0,
        variantsByKey: new Map()
      };
      cardsByKey.set(cardKey, card);
    } else {
      card.isLatest = card.isLatest || Boolean(s.isLatest);
      // 카드 레벨 태그는 "처음 값"이 비어있을 수 있으므로, 이후 곡에서 값이 있으면 채운다.
      if (!card.genre && s.genre) card.genre = s.genre;
      if (!card.mood && s.mood) card.mood = s.mood;
      if (!card.vocal && s.vocal) card.vocal = s.vocal;
        const ms = s.driveModifiedTime ? new Date(s.driveModifiedTime).getTime() : 0;
        if (ms > (card.latestModifiedMs || 0)) card.latestModifiedMs = ms;
    }

    const k = String(key || '').trim();
    const existing = card.variantsByKey.get(k);
    if (!existing || String(s.googleFileId) < String(existing.googleFileId)) {
      const myAvail = availableUserId ? availMap?.get(String(s.googleFileId || '')) : null;
      card.variantsByKey.set(k, {
        key: k,
        songId: String(s._id),
        googleFileId: s.googleFileId,
        driveUrl: s.driveUrl || '',
        driveModifiedMs: s.driveModifiedTime ? new Date(s.driveModifiedTime).getTime() : 0,
        proficiency: Number(myAvail?.proficiency || 0) || 0
      });
    }
    fileIdToCardKey.set(String(s.googleFileId), cardKey);
  }
  if (fixOps.length) Song.bulkWrite(fixOps, { ordered: false }).catch(() => {});

  // Availability -> card별 가능한 유저(프로필) 집계
  const cardAvailUsers = new Map(); // cardKey -> Set<userId>
  const fileIds = Array.from(fileIdToCardKey.keys());
  if (fileIds.length) {
    const av = await Availability.find({ googleFileId: { $in: fileIds }, available: true }).lean();
    av.forEach((a) => {
      const fid = String(a.googleFileId || '');
      const ck = fileIdToCardKey.get(fid);
      if (!ck) return;
      const uid = String(a.userId || '').trim();
      if (!uid) return;
      if (!cardAvailUsers.has(ck)) cardAvailUsers.set(ck, new Set());
      cardAvailUsers.get(ck).add(uid);
    });
  }
  const allUserIds = Array.from(new Set(Array.from(cardAvailUsers.values()).flatMap((s) => Array.from(s))));
  const userMap = new Map();
  if (allUserIds.length) {
    // include admin too (profilePhoto/displayName should still work)
    // private 계정은 메인 UI(가능곡 아이콘/세션 아이콘) 어디에도 노출하지 않는다.
    const users = await User.find({ userId: { $in: allUserIds }, active: { $ne: false }, isPrivate: { $ne: true } }).lean();
    users.forEach((u) => userMap.set(String(u.userId), u));
  }

  const cards = [];
  for (const card of cardsByKey.values()) {
    const variants = Array.from(card.variantsByKey.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const keys = variants.map((v) => v.key);
    const searchText = `${card.title} ${card.artist} ${card.genre} ${card.mood} ${card.vocal} ${keys.join(' ')}`.toLowerCase();
    const latestMs =
      Number(card.latestModifiedMs || 0) || Math.max(0, ...variants.map((v) => Number(v.driveModifiedMs || 0)));
    const proficiencyLevel = availableUserId ? Math.max(0, ...variants.map((v) => Number(v.proficiency || 0) || 0)) : 0;
    const uids = Array.from(cardAvailUsers.get(card.cardId) || []);
    const availableUsers = uids
      .map((uid) => {
        const u = userMap.get(uid);
        if (!u) return null;
        const displayName = String(u?.displayName || uid);
        return { userId: uid, displayName, profilePhoto: String(u?.profilePhoto || '') };
      })
      .filter(Boolean)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 12);
    cards.push({
      cardId: card.cardId,
      title: card.title,
      artist: card.artist,
      genre: card.genre,
      mood: card.mood,
      vocal: card.vocal,
      isLatest: card.isLatest,
      // musicbook UI의 "최신곡" 정렬 버튼(data-sort-field="createdAt") 호환을 위해 숫자(ms)로 제공
      createdAt: latestMs || 0,
      keys,
      variants,
      proficiencyLevel,
      availableUsers,
      searchText
    });
  }

  res.json({
    ok: true,
    items: cards,
    // 정확한 수치(5000 cap 무관)
    totalDocs,
    totalCards,
    // 하위 호환: 기존 클라이언트용
    total: totalCards,
    truncated: Number(totalDocs || 0) > MAX_DOCS_FOR_CARDS
  });
});

// session/admin: 태그가 비어있는 곡은 "최초 1회" 입력을 유도(빈 값만 채움)
router.patch('/songs/tags', requireSessionOrAdmin, async (req, res) => {
  const googleFileId = String(req.body?.googleFileId || '').trim();
  const genre = String(req.body?.genre || '').trim();
  const mood = String(req.body?.mood || '').trim();
  const vocal = String(req.body?.vocal || '').trim();
  const overwrite = Boolean(req.body?.overwrite);
  if (!googleFileId || !genre || !mood || !vocal) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const one = await Song.findOne({ googleFileId }).lean();
  if (!one) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const title = String(one.title || '').trim();
  const artist = String(one.artist || '').trim();
  if (!title) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const r = overwrite
    ? await Song.updateMany(
        { title, artist },
        {
          $set: {
            genre,
            mood,
            vocal,
            updatedAt: new Date(),
            searchText: `${one.displayTitle || ''} ${title} ${artist} ${one.key || ''} ${genre} ${mood} ${vocal}`.toLowerCase().trim()
          }
        }
      )
    : await Song.updateMany(
        { title, artist },
        [
          {
            $set: {
              genre: { $cond: [{ $eq: [{ $ifNull: ['$genre', ''] }, ''] }, genre, '$genre'] },
              mood: { $cond: [{ $eq: [{ $ifNull: ['$mood', ''] }, ''] }, mood, '$mood'] },
              vocal: { $cond: [{ $eq: [{ $ifNull: ['$vocal', ''] }, ''] }, vocal, '$vocal'] }
            }
          },
          {
            $set: {
              searchText: {
                $toLower: {
                  $concat: [
                    { $ifNull: ['$displayTitle', ''] },
                    ' ',
                    { $ifNull: ['$title', ''] },
                    ' ',
                    { $ifNull: ['$artist', ''] },
                    ' ',
                    { $ifNull: ['$key', ''] },
                    ' ',
                    { $ifNull: ['$genre', ''] },
                    ' ',
                    { $ifNull: ['$mood', ''] },
                    ' ',
                    { $ifNull: ['$vocal', ''] }
                  ]
                }
              }
            }
          }
        ]
      );

  return res.json({ ok: true, matched: r.matchedCount ?? r.n ?? 0, modified: r.modifiedCount ?? r.nModified ?? 0 });
});

// session/admin: 카드(title+artist) 단위로 태그(장르/분위기/보컬) 수정 가능하게 제공
router.patch('/songs/card-tags', requireSessionOrAdmin, async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const artist = String(req.body?.artist || '').trim();
  const genre = req.body?.genre !== undefined ? String(req.body.genre || '').trim() : undefined;
  const mood = req.body?.mood !== undefined ? String(req.body.mood || '').trim() : undefined;
  const vocal = req.body?.vocal !== undefined ? String(req.body.vocal || '').trim() : undefined;
  if (!title) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  /** @type {Record<string, any>} */
  const $set = {};
  if (genre !== undefined) $set.genre = genre;
  if (mood !== undefined) $set.mood = mood;
  if (vocal !== undefined) $set.vocal = vocal;
  if (!Object.keys($set).length) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  $set.updatedAt = new Date();

  // searchText는 카드 기준으로 재구성(곡별 key는 유지)
  const r = await Song.updateMany(
    { artist, $or: [{ title }, { displayTitle: title }] },
    [
      { $set: $set },
      {
        $set: {
          searchText: {
            $toLower: {
              $concat: [
                { $ifNull: ['$displayTitle', ''] },
                ' ',
                { $ifNull: ['$title', ''] },
                ' ',
                { $ifNull: ['$artist', ''] },
                ' ',
                { $ifNull: ['$key', ''] },
                ' ',
                { $ifNull: ['$genre', ''] },
                ' ',
                { $ifNull: ['$mood', ''] },
                ' ',
                { $ifNull: ['$vocal', ''] }
              ]
            }
          }
        }
      }
    ]
  );

  res.json({ ok: true, matched: r.matchedCount ?? r.n ?? 0, modified: r.modifiedCount ?? r.nModified ?? 0 });
});

// Admin/session write (for later: sync or manual edits)
router.post('/songs', requireSessionOrAdmin, async (req, res) => {
  const body = req.body || {};
  const googleFileId = String(body.googleFileId || '').trim();
  const title = String(body.title || '').trim();
  if (!googleFileId || !title) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });

  const searchText = `${title} ${body.displayTitle || ''} ${body.artist || ''}`.toLowerCase();
  const doc = await Song.findOneAndUpdate(
    { googleFileId },
    {
      $set: {
        title,
        displayTitle: String(body.displayTitle || ''),
        artist: String(body.artist || ''),
        key: String(body.key || ''),
        genre: String(body.genre || ''),
        mood: String(body.mood || ''),
        vocal: String(body.vocal || ''),
        driveUrl: String(body.driveUrl || ''),
        folderPath: String(body.folderPath || ''),
        isLatest: Boolean(body.isLatest),
        hidden: Boolean(body.hidden),
        searchText
      }
    },
    { upsert: true, new: true }
  );

  res.json({ ok: true, item: doc.toObject() });
});

module.exports = router;
