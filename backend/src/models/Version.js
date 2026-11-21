const mongoose = require('mongoose');

const versionSchema = new mongoose.Schema(
  {
    fileId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    versionNumber: { type: Number, required: true },
    originalName: { type: String, required: true },
    fileName: { type: String, required: true },
    s3Key: { type: String, required: true },
    mimeType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
    reservedSize: { type: Number, default: 0 },
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.models.Version || mongoose.model('Version', versionSchema);
