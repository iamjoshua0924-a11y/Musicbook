const mongoose = require('mongoose');

const GuestbookEntrySchema = new mongoose.Schema(
  {
    bookUserId: { type: String, required: true, index: true },
    nickname: { type: String, required: true, trim: true, maxlength: 40 },
    content: { type: String, required: true, trim: true, maxlength: 500 },
    authorUserId: { type: String, default: '', trim: true },
    createdAt: { type: Date, default: () => new Date(), index: true }
  },
  { versionKey: false }
);

GuestbookEntrySchema.index({ bookUserId: 1, createdAt: -1 });

module.exports = mongoose.model('GuestbookEntry', GuestbookEntrySchema);
