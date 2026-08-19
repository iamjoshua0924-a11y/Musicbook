const Availability = require('../models/Availability');

const clampProficiency = (v) => Math.max(0, Math.min(3, Number(v || 0) || 0));

// items: [{ googleFileId, available?, proficiency? }, ...]
// src/routes/availability.js(POST /api/availability/bulk)의 upsert 로직을 그대로 뽑아둔 것.
// src/routes/privateAvailableSongs.js(가능곡 벌크 추가)에서도 재사용한다 — 새 Availability 로직을
// 따로 만들지 않고 이걸 그대로 호출한다.
async function bulkUpsertAvailability(userId, items) {
  const uid = String(userId || '').trim();
  const list = Array.isArray(items) ? items : [];
  if (!uid || !list.length) return { count: 0 };

  const ops = list
    .map((it) => {
      const hasAvailable = it?.available !== undefined;
      const hasProficiency = it?.proficiency !== undefined;
      return {
        userId: uid,
        googleFileId: String(it?.googleFileId || '').trim(),
        hasAvailable,
        hasProficiency,
        available: Boolean(it?.available),
        proficiency: clampProficiency(it?.proficiency)
      };
    })
    .filter((it) => it.googleFileId && (it.hasAvailable || it.hasProficiency));

  if (!ops.length) return { count: 0 };

  const bulk = Availability.collection.initializeUnorderedBulkOp();
  const now = new Date();
  ops.forEach((it) => {
    /** @type {Record<string, any>} */
    const $set = { userId: it.userId, googleFileId: it.googleFileId, updatedAt: now };
    if (it.hasAvailable) $set.available = it.available;
    if (it.hasProficiency) $set.proficiency = it.proficiency;
    bulk
      .find({ userId: it.userId, googleFileId: it.googleFileId })
      .upsert()
      .updateOne({ $set });
  });

  await bulk.execute();
  return { count: ops.length };
}

module.exports = { bulkUpsertAvailability };
