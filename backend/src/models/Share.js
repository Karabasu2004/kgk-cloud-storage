const mongoose = require('mongoose');

const shareSchema = new mongoose.Schema(
  {
    fileId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true },
    shareUrl: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    downloads: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Share || mongoose.model('Share', shareSchema);
