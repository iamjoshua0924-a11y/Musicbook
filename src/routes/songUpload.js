const path = require('node:path');
const express = require('express');
const Song = require('../models/Song');
const Availability = require('../models/Availability');
const { requireLogin, requireSessionOrAdmin } = require('../middleware/auth');
const { uploadSingle, uploadArray } = require('../middleware/upload');
const { getDriveRootFolderId } = require('../services/driveSyncRunner');
const { createFile, buildViewUrl } = require('../services/drive');
const { buildSongFileName, normalizeSongFileName } = require('../services/songNameNormalizer');
const { isPlaceholderGoogleFileId } = require('../services/placeholderSong');
const { bulkUpsertAvailability } = require('../services/availabilityBulk');

const router = express.Router();

// 벌크 업로드 한 번에 처리할 파일 수 상한(사고 방지용 안전장치, 스펙엔 명시 없음).
const MAX_BULK_FILES = 50;

function buildSearchText({ displayTitle, title, artist, genre, key }) {
  return `${displayTitle || ''} ${title || ''} ${artist || ''} ${genre || ''} ${key || ''}`.toLowerCase().trim();
}

function isTruthyFlag(v) {
  return v === true || v === 'true' || v === '1' || v === 1;
}

// 여러 파일을 드롭했을 때, 그리드 각 행의 title/key/artist 초기값을 파일명에서 미리 뽑아준다.
// driveSync가 이미 검증해서 쓰고 있는 normalizeSongFileName()을 그대로 재사용한다(별도 구현 없음).
router.post('/songs/parse-filenames', requireLogin, (req, res) => {
  const filenames = Array.isArray(req.body?.filenames) ? req.body.filenames : [];
  const items = filenames.slice(0, 200).map((raw) => {
    const filename = String(raw || '');
    const ext = path.extname(filename);
    const filenameNoExt = ext ? filename.slice(0, -ext.length) : filename;
    const parsed = normalizeSongFileName({ filenameNoExt });
    return { filename, title: parsed.title, key: parsed.key, artist: parsed.artist, parseError: parsed.parseError };
  });
  res.json({ ok: true, items });
});

// 단일 파일 업로드: Drive 루트 폴더에 파싱규칙대로 리네임되어 올라가고 곡 카드가 생성된다.
router.post('/songs/upload', requireSessionOrAdmin, uploadSingle('file'), async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const artist = String(req.body?.artist || '').trim();
  const key = String(req.body?.key || '').trim();
  const genre = String(req.body?.genre || '').trim();
  const markAvailableForSelf = isTruthyFlag(req.body?.markAvailableForSelf);
  if (!title) return res.status(400).json({ ok: false, error: 'TITLE_REQUIRED' });
  if (!artist) return res.status(400).json({ ok: false, error: 'ARTIST_REQUIRED' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'FILE_REQUIRED' });

  try {
    const rootFolderId = await getDriveRootFolderId();
    if (!rootFolderId) return res.status(500).json({ ok: false, error: 'ROOT_FOLDER_NOT_CONFIGURED' });

    const ext = path.extname(req.file.originalname || '') || '.pdf';
    const filename = buildSongFileName({ title, key, artist }, ext);
    const createdFile = await createFile(rootFolderId, filename, req.file.mimetype, req.file.buffer);
    const googleFileId = String(createdFile.id || '').trim();
    if (!googleFileId) return res.status(500).json({ ok: false, error: 'DRIVE_UPLOAD_FAILED' });

    const displayTitle = title;
    const doc = await Song.create({
      googleFileId,
      title,
      displayTitle,
      artist,
      key,
      genre,
      hasScoreFile: true,
      scope: 'global',
      driveUrl: buildViewUrl(googleFileId),
      searchText: buildSearchText({ displayTitle, title, artist, genre, key })
    });

    if (markAvailableForSelf && req.session?.user?.userId) {
      await bulkUpsertAvailability(req.session.user.userId, [{ googleFileId, available: true }]);
    }

    res.json({
      ok: true,
      item: { songId: String(doc._id), googleFileId, title, artist, key, genre, driveUrl: doc.driveUrl }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || 'UPLOAD_FAILED') });
  }
});

// 다중 파일 업로드: 프론트의 벌크 그리드(Phase 3 재사용)에서 파일별 메타데이터(title/artist/key/genre)를
// meta(JSON 배열, files[]와 같은 순서)로 함께 보낸다. 부분 실패를 허용한다(Phase 3와 동일 패턴).
router.post('/songs/upload/bulk', requireSessionOrAdmin, uploadArray('files', MAX_BULK_FILES), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ ok: false, error: 'FILES_REQUIRED' });

  let metaList;
  try {
    metaList = JSON.parse(req.body?.meta || '[]');
  } catch {
    return res.status(400).json({ ok: false, error: 'BAD_META' });
  }
  if (!Array.isArray(metaList)) return res.status(400).json({ ok: false, error: 'BAD_META' });

  const markAvailableForSelf = isTruthyFlag(req.body?.markAvailableForSelf);
  const rootFolderId = await getDriveRootFolderId();
  if (!rootFolderId) return res.status(500).json({ ok: false, error: 'ROOT_FOLDER_NOT_CONFIGURED' });

  const created = [];
  const failed = [];

  // 순차 처리: Drive API 호출이 섞여 있어 병렬로 몰아치면 rate limit에 걸리기 쉽고,
  // 실패 격리(부분 실패 허용)도 순차 쪽이 다루기 단순하다.
  for (const [idx, file] of files.entries()) {
    const meta = metaList[idx] || {};
    const title = String(meta?.title || '').trim();
    const artist = String(meta?.artist || '').trim();
    const key = String(meta?.key || '').trim();
    const genre = String(meta?.genre || '').trim();

    if (!title) {
      failed.push({ row: idx, filename: file.originalname, reason: 'TITLE_REQUIRED' });
      continue;
    }
    if (!artist) {
      failed.push({ row: idx, filename: file.originalname, reason: 'ARTIST_REQUIRED' });
      continue;
    }

    try {
      const ext = path.extname(file.originalname || '') || '.pdf';
      const filename = buildSongFileName({ title, key, artist }, ext);
      // eslint-disable-next-line no-await-in-loop
      const createdFile = await createFile(rootFolderId, filename, file.mimetype, file.buffer);
      const googleFileId = String(createdFile.id || '').trim();
      if (!googleFileId) throw new Error('DRIVE_UPLOAD_FAILED');

      const displayTitle = title;
      // eslint-disable-next-line no-await-in-loop
      const doc = await Song.create({
        googleFileId,
        title,
        displayTitle,
        artist,
        key,
        genre,
        hasScoreFile: true,
        scope: 'global',
        driveUrl: buildViewUrl(googleFileId),
        searchText: buildSearchText({ displayTitle, title, artist, genre, key })
      });
      created.push({
        row: idx,
        songId: String(doc._id),
        googleFileId,
        title,
        artist,
        key,
        genre,
        filename: file.originalname,
        driveUrl: doc.driveUrl
      });
    } catch (e) {
      failed.push({ row: idx, filename: file.originalname, reason: String(e?.message || 'UPLOAD_FAILED') });
    }
  }

  if (markAvailableForSelf && created.length && req.session?.user?.userId) {
    await bulkUpsertAvailability(
      req.session.user.userId,
      created.map((c) => ({ googleFileId: c.googleFileId, available: true }))
    );
  }

  res.json({ ok: true, created, failed });
});

// 악보 없음/코드위키 placeholder 곡 승격 + 코드위키 링크 추가/교체를 한 엔드포인트로 처리한다.
// file, externalLink 중 최소 하나는 있어야 하고, 둘 다 와도 둘 다 처리한다.
router.post('/songs/:id/attach-file', requireLogin, uploadSingle('file'), async (req, res) => {
  const id = String(req.params.id || '').trim();
  const hasExternalLinkField = req.body?.externalLink !== undefined;
  const externalLink = hasExternalLinkField ? String(req.body.externalLink || '').trim() : undefined;
  const file = req.file;
  if (!id) return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  if (!file && !hasExternalLinkField) return res.status(400).json({ ok: false, error: 'FILE_OR_LINK_REQUIRED' });

  const song = await Song.findById(id);
  if (!song) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

  const sessionUser = req.session?.user;
  const userId = String(sessionUser?.userId || '').trim();
  const isOwner = song.scope === 'private' && String(song.privateOwnerId || '') === userId && Boolean(userId);
  const isAdmin = sessionUser?.role === 'admin';
  if (!isOwner && !isAdmin) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

  const update = {};

  if (file) {
    try {
      const rootFolderId = await getDriveRootFolderId();
      if (!rootFolderId) return res.status(500).json({ ok: false, error: 'ROOT_FOLDER_NOT_CONFIGURED' });

      const ext = path.extname(file.originalname || '') || '.pdf';
      const filename = buildSongFileName(
        { title: song.displayTitle || song.title, key: song.key, artist: song.artist },
        ext
      );
      const createdFile = await createFile(rootFolderId, filename, file.mimetype, file.buffer);
      const newGoogleFileId = String(createdFile.id || '').trim();
      if (!newGoogleFileId) return res.status(500).json({ ok: false, error: 'DRIVE_UPLOAD_FAILED' });

      const oldGoogleFileId = String(song.googleFileId || '').trim();
      // 중요: googleFileId를 새 값으로 바꾸기 *전에* 기존 Availability 표시를 이관한다.
      // placeholder(local-...) 승격이 가장 흔한 경우지만, 이미 실제 파일이 있던 곡을 다시
      // 업로드해 교체하는 경우도 같은 이유로 이관이 필요해 조건을 placeholder로 한정하지 않았다.
      // 이걸 빼먹으면 오너의 "가능곡" 표시가 조용히 사라진다.
      if (oldGoogleFileId && oldGoogleFileId !== newGoogleFileId) {
        await Availability.updateMany({ googleFileId: oldGoogleFileId }, { $set: { googleFileId: newGoogleFileId } });
      }

      update.googleFileId = newGoogleFileId;
      update.hasScoreFile = true;
      update.driveUrl = buildViewUrl(newGoogleFileId);
      // privateOwnerId는 지우지 않는다(이력) - scope만 바뀌면 Phase 2의 { scope: { $ne: 'private' } }
      // 필터 기준으로 정상적으로 전역 노출된다.
      update.scope = 'global';
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || 'UPLOAD_FAILED') });
    }
  }

  if (hasExternalLinkField) update.externalLink = externalLink;
  update.updatedAt = new Date();

  const doc = await Song.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  res.json({
    ok: true,
    item: {
      songId: String(doc._id),
      googleFileId: doc.googleFileId,
      hasScoreFile: doc.hasScoreFile !== false,
      scope: doc.scope || 'global',
      externalLink: doc.externalLink || '',
      driveUrl: doc.driveUrl || ''
    }
  });
});

module.exports = router;
