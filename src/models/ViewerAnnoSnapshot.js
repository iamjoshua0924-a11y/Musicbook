const mongoose = require('mongoose');

/**
 * Minimal backup: persisted only when a session room becomes empty.
 * TTL index will clean automatically.
 */
const ViewerAnnoSnapshotSchema = new mongoose.Schema(
  {
    roomCode: { type: String, index: true, required: true },
    fileId: { type: String, index: true, required: true },
    snapshot: { type: Object, required: true }, // { [pageNo]: { json, w, h } }
    updatedAt: { type: Date, required: true },
    expireAt: { type: Date, required: true, index: { expires: 0 } }
  },
  { minimize: false }
);

ViewerAnnoSnapshotSchema.index({ roomCode: 1, fileId: 1 }, { unique: true });

module.exports = mongoose.model('ViewerAnnoSnapshot', ViewerAnnoSnapshotSchema);

