const Setting = require('../models/Setting');

const KEYS = {
  driveSyncStatus: 'driveSyncStatus',
  driveSyncLastAt: 'driveSyncLastAt'
};

async function setJson(key, obj) {
  await Setting.findOneAndUpdate(
    { key },
    { $set: { key, value: JSON.stringify(obj) } },
    { upsert: true }
  );
}

async function getJson(key, fallback = null) {
  const doc = await Setting.findOne({ key }).lean();
  if (!doc?.value) return fallback;
  try {
    return JSON.parse(doc.value);
  } catch {
    return fallback;
  }
}

module.exports = { KEYS, setJson, getJson };

