const mongoose = require('mongoose');

const RequestSchema = new mongoose.Schema(
  {
    // Optional link to Song for future; allow raw text too (GAS compatibility)
    songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: false },

    requesterSessionId: { type: String, required: true, index: true },
    requesterName: { type: String, required: true },

    songTitle: { type: String, required: true },
    artist: { type: String, default: '' },
    targetSinger: { type: String, default: '' },
    memo: { type: String, default: '' },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'completed'],
      default: 'pending',
      index: true
    },

    createdAt: { type: Date, default: () => new Date(), index: true },
    updatedAt: { type: Date, default: () => new Date() }
  },
  { minimize: false }
);

RequestSchema.pre('save', function preSave(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Request', RequestSchema);

