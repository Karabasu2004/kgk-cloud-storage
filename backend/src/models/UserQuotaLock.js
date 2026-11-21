const mongoose = require('mongoose');

const userQuotaLockSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    lockToken: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true, collection: 'userquotalocks' },
);

module.exports = mongoose.models.UserQuotaLock
  || mongoose.model('UserQuotaLock', userQuotaLockSchema);
