const mongoose = require('mongoose');
const crypto = require('node:crypto');
const { inMemoryFiles, inMemoryFolders, inMemoryShares, inMemoryVersions } = require('../config/database');
const { File, Folder, Share, Version } = require('../models');
const UserQuotaLock = require('../models/UserQuotaLock');
const {
  getMaxUploadSizeBytes,
  getMaxUserStorageBytes,
  getMaxUserFiles,
  getPublicApiBaseUrl,
} = require('../config/productionConfig');
const {
  generateUploadUrl,
  generateDownloadUrl,
  verifyS3Object,
  deleteS3Objects,
} = require('../services/s3Service');

const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1000; // 1 hour
const QUOTA_LOCK_TTL_MS = 60 * 1000;
const QUOTA_LOCK_WAIT_MS = 50;
const QUOTA_LOCK_TIMEOUT_MS = 10 * 1000;
const inMemoryQuotaQueues = new Map();
let quotaLockIndexesPromise;

const isMongoReady = () => {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (process.env.NODE_ENV === 'production') {
    const error = new Error('Database temporarily unavailable');
    error.statusCode = 503;
    throw error;
  }

  return false;
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Serialize quota reservations per user. MongoDB locking works across Render instances;
// the in-memory queue keeps local/test behavior deterministic within one process.
const withUserQuotaLock = async (userId, operation) => {
  if (isMongoReady()) {
    if (!quotaLockIndexesPromise) {
      quotaLockIndexesPromise = UserQuotaLock.createIndexes().catch((error) => {
        quotaLockIndexesPromise = null;
        throw error;
      });
    }
    await quotaLockIndexesPromise;

    const lockToken = crypto.randomUUID();
    const deadline = Date.now() + QUOTA_LOCK_TIMEOUT_MS;
    let acquired = false;

    while (!acquired && Date.now() < deadline) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + QUOTA_LOCK_TTL_MS);

      const reclaimed = await UserQuotaLock.findOneAndUpdate(
        { userId, expiresAt: { $lte: now } },
        { $set: { lockToken, expiresAt } },
        { new: true },
      );

      if (reclaimed) {
        acquired = true;
        break;
      }

      try {
        await UserQuotaLock.create({ userId, lockToken, expiresAt });
        acquired = true;
      } catch (error) {
        if (error.code !== 11000) throw error;
      }

      if (!acquired) await sleep(QUOTA_LOCK_WAIT_MS);
    }

    if (!acquired) {
      const error = new Error('Storage quota is busy. Please retry the upload.');
      error.statusCode = 503;
      throw error;
    }

    const renewalTimer = setInterval(() => {
      UserQuotaLock.updateOne(
        { userId, lockToken },
        { $set: { expiresAt: new Date(Date.now() + QUOTA_LOCK_TTL_MS) } },
      ).catch(() => {});
    }, Math.floor(QUOTA_LOCK_TTL_MS / 3));
    renewalTimer.unref?.();

    try {
      return await operation();
    } finally {
      clearInterval(renewalTimer);
      try {
        await UserQuotaLock.deleteOne({ userId, lockToken });
      } catch {
        // The short lock lease expires automatically if MongoDB cannot release it now.
      }
    }
  }

  const previous = inMemoryQuotaQueues.get(userId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  inMemoryQuotaQueues.set(userId, current);
  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (inMemoryQuotaQueues.get(userId) === current) {
      inMemoryQuotaQueues.delete(userId);
    }
  }
};

const cleanupPendingRecord = async (userId, record, recordType) => {
  // Remove the S3 object before releasing the reservation. If S3 deletion fails,
  // retain the database record so quota accounting remains conservative.
  await deleteS3Objects(userId, [record.s3Key]);

  if (isMongoReady()) {
    const Model = recordType === 'version' ? Version : File;
    await Model.deleteOne({ _id: record._id, userId, status: 'pending' });
    return;
  }

  const collection = recordType === 'version' ? inMemoryVersions : inMemoryFiles;
  const recordId = record.id || record._id?.toString?.();
  const index = collection.findIndex((item) => (
    (item.id || item._id?.toString?.()) === recordId
    && item.userId === userId
    && item.status === 'pending'
  ));
  if (index !== -1) collection.splice(index, 1);
};

const cleanupExpiredPendingForUser = async (userId) => {
  const cutoff = new Date(Date.now() - PENDING_UPLOAD_TTL_MS);

  if (isMongoReady()) {
    const query = {
      userId,
      status: { $in: ['pending', 'failed'] },
      createdAt: { $lte: cutoff },
    };
    const [expiredFiles, expiredVersions] = await Promise.all([
      File.find(query),
      Version.find(query),
    ]);
    const keys = [...new Set([
      ...expiredFiles.map((item) => item.s3Key),
      ...expiredVersions.map((item) => item.s3Key),
    ].filter((key) => typeof key === 'string' && key.length > 0))];

    await deleteS3Objects(userId, keys);
    if (expiredFiles.length) {
      await File.deleteMany({ _id: { $in: expiredFiles.map((item) => item._id) }, userId });
    }
    if (expiredVersions.length) {
      await Version.deleteMany({ _id: { $in: expiredVersions.map((item) => item._id) }, userId });
    }
    return;
  }

  const isExpiredReservation = (item) => (
    ['pending', 'failed'].includes(item.status)
    && new Date(item.createdAt || 0).getTime() <= cutoff.getTime()
  );
  const expiredFiles = inMemoryFiles.filter((item) => item.userId === userId && isExpiredReservation(item));
  const expiredVersions = inMemoryVersions.filter((item) => item.userId === userId && isExpiredReservation(item));
  const keys = [...new Set([
    ...expiredFiles.map((item) => item.s3Key),
    ...expiredVersions.map((item) => item.s3Key),
  ].filter((key) => typeof key === 'string' && key.length > 0))];

  await deleteS3Objects(userId, keys);
  for (let index = inMemoryFiles.length - 1; index >= 0; index -= 1) {
    if (inMemoryFiles[index].userId === userId && isExpiredReservation(inMemoryFiles[index])) {
      inMemoryFiles.splice(index, 1);
    }
  }
  for (let index = inMemoryVersions.length - 1; index >= 0; index -= 1) {
    if (inMemoryVersions[index].userId === userId && isExpiredReservation(inMemoryVersions[index])) {
      inMemoryVersions.splice(index, 1);
    }
  }
};

const normalizeRecord = (record) => {
  if (!record) return null;

  const plain = record.toObject ? record.toObject() : record;
  const recordId = plain.id || plain._id?.toString?.() || null;

  return {
    ...plain,
    id: recordId,
    isStarred: Boolean(plain.isStarred),
    isDeleted: Boolean(plain.isDeleted),
    deletedAt: plain.deletedAt || null,
  };
};

const isValidUploadSize = (size) => Number.isSafeInteger(size) && size >= 0;

const isOversizedObject = (actualSize) => actualSize > getMaxUploadSizeBytes();

const isValidShareExpiry = (minutes) => (
  Number.isInteger(minutes) && minutes >= 1 && minutes <= 10080
);

const createShareUrl = (req, token) => {
  return `${getPublicApiBaseUrl(req)}/files/shared/${token}`;
};

const classifyFileType = (mimeType = '', fileName = '') => {
  const combined = `${mimeType || ''} ${fileName || ''}`.toLowerCase();

  if (combined.includes('image/')) return 'image';
  if (combined.includes('video/')) return 'video';
  if (combined.includes('audio/')) return 'audio';
  if (combined.includes('zip') || combined.includes('rar') || combined.includes('tar') || combined.includes('gzip')) return 'archive';
  if (combined.includes('pdf') || combined.includes('document') || combined.includes('sheet') || combined.includes('presentation') || combined.includes('text/plain') || combined.includes('csv') || combined.includes('json')) return 'document';

  return 'other';
};

// Calculate user quota (file count and storage bytes), including pending reservations and Trash.
// Expired pending/failed reservations are removed under the per-user quota lock before this runs.
const getUserQuota = async (userId, excludeS3Key = null) => {
  const maxStorageBytes = getMaxUserStorageBytes();
  const maxFiles = getMaxUserFiles();

  if (isMongoReady()) {
    const userFiles = await File.find({ userId });
    const userVersions = await Version.find({ userId });

    // File count includes active files, Trash, and pending upload reservations.
    let fileCount = 0;
    const keySizeMap = new Map();

    for (const file of userFiles) {
      if (file.status === 'failed') continue;
      fileCount += 1;

      if (file.s3Key && file.s3Key !== excludeS3Key) {
        const existing = keySizeMap.get(file.s3Key) || 0;
        keySizeMap.set(file.s3Key, Math.max(existing, file.size || 0));
      }
    }

    for (const version of userVersions) {
      if (version.status === 'failed') continue;

      if (version.s3Key && version.s3Key !== excludeS3Key) {
        const existing = keySizeMap.get(version.s3Key) || 0;
        keySizeMap.set(version.s3Key, Math.max(existing, version.size || 0));
      }
    }

    let usedStorageBytes = 0;
    for (const size of keySizeMap.values()) {
      usedStorageBytes += size;
    }

    return {
      fileCount,
      usedStorageBytes,
      maxStorageBytes,
      maxFiles,
    };
  }

  const userFiles = inMemoryFiles.filter((file) => file.userId === userId);
  const userVersions = inMemoryVersions.filter((version) => version.userId === userId);

  let fileCount = 0;
  const keySizeMap = new Map();

  for (const file of userFiles) {
    if (file.status === 'failed') continue;
    fileCount += 1;

    if (file.s3Key && file.s3Key !== excludeS3Key) {
      const existing = keySizeMap.get(file.s3Key) || 0;
      keySizeMap.set(file.s3Key, Math.max(existing, file.size || 0));
    }
  }

  for (const version of userVersions) {
    if (version.status === 'failed') continue;

    if (version.s3Key && version.s3Key !== excludeS3Key) {
      const existing = keySizeMap.get(version.s3Key) || 0;
      keySizeMap.set(version.s3Key, Math.max(existing, version.size || 0));
    }
  }

  let usedStorageBytes = 0;
  for (const size of keySizeMap.values()) {
    usedStorageBytes += size;
  }

  return {
    fileCount,
    usedStorageBytes,
    maxStorageBytes,
    maxFiles,
  };
};

const getUserQuotaInfo = async (req, res, next) => {
  try {
    const quota = await withUserQuotaLock(req.user.userId, async () => {
      await cleanupExpiredPendingForUser(req.user.userId);
      return getUserQuota(req.user.userId);
    });
    return res.status(200).json(quota);
  } catch (error) {
    next(error);
  }
};

const listFiles = async (req, res, next) => {
  try {
    const { search = '', type = '', sortBy = 'createdAt', order = 'desc', folderId = '' } = req.query;

    const normalizedSearch = String(search).trim().toLowerCase();
    const normalizedType = String(type).trim().toLowerCase();
    const normalizedSort = ['name', 'size', 'createdAt'].includes(sortBy) ? sortBy : 'createdAt';
    const normalizedOrder = order === 'asc' ? 'asc' : 'desc';

    if (isMongoReady()) {
      const query = {
        userId: req.user.userId,
        isDeleted: { $ne: true },
        status: { $ne: 'failed' },
      };
      if (folderId) {
        query.folderId = folderId;
      }

      let userFiles = (await File.find(query).sort({ createdAt: -1 })).map(normalizeRecord);

      if (normalizedSearch) {
        userFiles = userFiles.filter((file) => {
          const haystack = `${file.originalName || ''} ${file.fileName || ''}`.toLowerCase();
          return haystack.includes(normalizedSearch);
        });
      }

      if (normalizedType) {
        userFiles = userFiles.filter((file) => classifyFileType(file.mimeType, file.originalName) === normalizedType);
      }

      userFiles = [...userFiles].sort((left, right) => {
        let comparison = 0;

        if (normalizedSort === 'name') {
          comparison = (left.originalName || '').localeCompare(right.originalName || '');
        } else if (normalizedSort === 'size') {
          comparison = (left.size || 0) - (right.size || 0);
        } else {
          comparison = new Date(left.createdAt) - new Date(right.createdAt);
        }

        return normalizedOrder === 'asc' ? comparison : comparison * -1;
      });

      return res.status(200).json({
        files: userFiles,
        total: userFiles.length,
      });
    }

    let userFiles = inMemoryFiles
      .filter((file) => file.userId === req.user.userId && !file.isDeleted && file.status !== 'failed')
      .map(normalizeRecord);

    if (folderId) {
      userFiles = userFiles.filter((file) => file.folderId === folderId);
    }

    if (normalizedSearch) {
      userFiles = userFiles.filter((file) => {
        const haystack = `${file.originalName || ''} ${file.fileName || ''}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      });
    }

    if (normalizedType) {
      userFiles = userFiles.filter((file) => classifyFileType(file.mimeType, file.originalName) === normalizedType);
    }

    userFiles = [...userFiles].sort((left, right) => {
      let comparison = 0;

      if (normalizedSort === 'name') {
        comparison = (left.originalName || '').localeCompare(right.originalName || '');
      } else if (normalizedSort === 'size') {
        comparison = (left.size || 0) - (right.size || 0);
      } else {
        comparison = new Date(left.createdAt) - new Date(right.createdAt);
      }

      return normalizedOrder === 'asc' ? comparison : comparison * -1;
    });

    return res.status(200).json({
      files: userFiles,
      total: userFiles.length,
    });
  } catch (error) {
    next(error);
  }
};

const listRecentFiles = async (req, res, next) => {
  try {
    if (isMongoReady()) {
      const userFiles = (await File.find({
        userId: req.user.userId,
        isDeleted: { $ne: true },
        status: { $ne: 'failed' },
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(50))
        .map(normalizeRecord);

      return res.status(200).json({
        files: userFiles,
        total: userFiles.length,
      });
    }

    const userFiles = inMemoryFiles
      .filter((file) => file.userId === req.user.userId && !file.isDeleted && file.status !== 'failed')
      .map(normalizeRecord)
      .sort((left, right) => {
        const leftDate = new Date(left.updatedAt || left.createdAt || 0);
        const rightDate = new Date(right.updatedAt || right.createdAt || 0);
        return rightDate - leftDate;
      })
      .slice(0, 50);

    return res.status(200).json({
      files: userFiles,
      total: userFiles.length,
    });
  } catch (error) {
    next(error);
  }
};

const listStarredFiles = async (req, res, next) => {
  try {
    if (isMongoReady()) {
      const userFiles = (await File.find({
        userId: req.user.userId,
        isStarred: true,
        isDeleted: { $ne: true },
        status: { $ne: 'failed' },
      })
        .sort({ updatedAt: -1, createdAt: -1 }))
        .map(normalizeRecord);

      return res.status(200).json({
        files: userFiles,
        total: userFiles.length,
      });
    }

    const userFiles = inMemoryFiles
      .filter((file) => file.userId === req.user.userId && file.isStarred && !file.isDeleted && file.status !== 'failed')
      .map(normalizeRecord)
      .sort((left, right) => {
        const leftDate = new Date(left.updatedAt || left.createdAt || 0);
        const rightDate = new Date(right.updatedAt || right.createdAt || 0);
        return rightDate - leftDate;
      });

    return res.status(200).json({
      files: userFiles,
      total: userFiles.length,
    });
  } catch (error) {
    next(error);
  }
};

const toggleStar = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file) {
        return res.status(404).json({ message: 'File not found.' });
      }

      if (file.isDeleted) {
        return res.status(400).json({ message: 'Cannot star a file in Trash.' });
      }

      file.isStarred = !Boolean(file.isStarred);
      file.updatedAt = new Date();
      await file.save();

      return res.status(200).json({
        message: file.isStarred ? 'File starred.' : 'File unstarred.',
        file: normalizeRecord(file),
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);
    if (!file) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to modify this file.' });
    }

    if (file.isDeleted) {
      return res.status(400).json({ message: 'Cannot star a file in Trash.' });
    }

    file.isStarred = !Boolean(file.isStarred);
    file.updatedAt = new Date().toISOString();

    return res.status(200).json({
      message: file.isStarred ? 'File starred.' : 'File unstarred.',
      file: normalizeRecord(file),
    });
  } catch (error) {
    next(error);
  }
};

const listTrashFiles = async (req, res, next) => {
  try {
    if (isMongoReady()) {
      const trashFiles = (await File.find({
        userId: req.user.userId,
        isDeleted: true,
      })
        .sort({ deletedAt: -1, updatedAt: -1 }))
        .map(normalizeRecord);

      return res.status(200).json({
        files: trashFiles,
        total: trashFiles.length,
      });
    }

    const trashFiles = inMemoryFiles
      .filter((file) => file.userId === req.user.userId && file.isDeleted && file.status !== 'failed')
      .map(normalizeRecord)
      .sort((left, right) => {
        const leftDate = new Date(left.deletedAt || left.updatedAt || 0);
        const rightDate = new Date(right.deletedAt || right.updatedAt || 0);
        return rightDate - leftDate;
      });

    return res.status(200).json({
      files: trashFiles,
      total: trashFiles.length,
    });
  } catch (error) {
    next(error);
  }
};

const restoreFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file) {
        return res.status(404).json({ message: 'File not found.' });
      }

      if (!file.isDeleted) {
        return res.status(400).json({ message: 'File is not in trash.' });
      }

      file.isDeleted = false;
      file.deletedAt = null;
      file.updatedAt = new Date();
      await file.save();

      return res.status(200).json({
        message: 'File restored successfully.',
        file: normalizeRecord(file),
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);
    if (!file) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to restore this file.' });
    }

    if (!file.isDeleted) {
      return res.status(400).json({ message: 'File is not in trash.' });
    }

    file.isDeleted = false;
    file.deletedAt = null;
    file.updatedAt = new Date().toISOString();

    return res.status(200).json({
      message: 'File restored successfully.',
      file: normalizeRecord(file),
    });
  } catch (error) {
    next(error);
  }
};

const permanentDeleteFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file) {
        return res.status(404).json({ message: 'File not found.' });
      }

      if (!file.isDeleted) {
        return res.status(400).json({ message: 'File must be in trash to be permanently deleted.' });
      }

      const versions = await Version.find({ fileId: file.id, userId: req.user.userId });
      const rawKeys = [file.s3Key, ...versions.map((version) => version.s3Key)];
      const uniqueKeys = [...new Set(rawKeys.filter((key) => typeof key === 'string' && key.length > 0))];

      // Delete S3 objects first - if S3 deletion fails, records are preserved
      await deleteS3Objects(req.user.userId, uniqueKeys);

      await Share.deleteMany({ fileId: file.id, userId: req.user.userId });
      await Version.deleteMany({ fileId: file.id, userId: req.user.userId });
      await File.deleteOne({ _id: id, userId: req.user.userId });

      return res.status(200).json({
        message: 'File permanently deleted.',
        fileId: id,
      });
    }

    const fileIndex = inMemoryFiles.findIndex((item) => item.id === id);
    if (fileIndex === -1) {
      return res.status(404).json({ message: 'File not found.' });
    }

    const file = inMemoryFiles[fileIndex];
    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to delete this file.' });
    }

    if (!file.isDeleted) {
      return res.status(400).json({ message: 'File must be in trash to be permanently deleted.' });
    }

    const versions = inMemoryVersions.filter(
      (version) => version.fileId === id && version.userId === req.user.userId,
    );
    const rawKeys = [file.s3Key, ...versions.map((version) => version.s3Key)];
    const uniqueKeys = [...new Set(rawKeys.filter((key) => typeof key === 'string' && key.length > 0))];

    // Delete S3 objects first
    await deleteS3Objects(req.user.userId, uniqueKeys);

    inMemoryFiles.splice(fileIndex, 1);
    for (let index = inMemoryShares.length - 1; index >= 0; index -= 1) {
      if (inMemoryShares[index].fileId === id) {
        inMemoryShares.splice(index, 1);
      }
    }
    for (let index = inMemoryVersions.length - 1; index >= 0; index -= 1) {
      if (inMemoryVersions[index].fileId === id) {
        inMemoryVersions.splice(index, 1);
      }
    }

    return res.status(200).json({
      message: 'File permanently deleted.',
      fileId: id,
    });
  } catch (error) {
    next(error);
  }
};

const createUploadUrl = async (req, res, next) => {
  try {
    const { fileName, mimeType, folderId, size } = req.body;

    if (!fileName || typeof fileName !== 'string' || !fileName.trim()) {
      return res.status(400).json({ message: 'fileName is required.' });
    }

    if (fileName.length > 255) {
      return res.status(400).json({ message: 'fileName is too long.' });
    }

    if (
      (size === undefined && process.env.NODE_ENV === 'production') ||
      (size !== undefined && !isValidUploadSize(size))
    ) {
      return res.status(400).json({ message: 'Valid file size is required.' });
    }

    if (size !== undefined && size > getMaxUploadSizeBytes()) {
      return res.status(413).json({ message: 'File exceeds the maximum allowed size.' });
    }

    return await withUserQuotaLock(req.user.userId, async () => {
      await cleanupExpiredPendingForUser(req.user.userId);
      // Quota check: file count limit and storage limit
      const quota = await getUserQuota(req.user.userId);
      const maxFiles = getMaxUserFiles();
      const maxStorageBytes = getMaxUserStorageBytes();
      const requestedSize = Number(size) || 0;

      if (quota.fileCount >= maxFiles) {
        return res.status(403).json({
          message: `File limit reached. You can only store up to ${maxFiles} files.`,
        });
      }

      if (quota.usedStorageBytes + requestedSize > maxStorageBytes) {
        return res.status(413).json({
          message: `Storage limit reached. You have used ${quota.usedStorageBytes} of ${maxStorageBytes} bytes.`,
        });
      }

      let resolvedFolderId = null;
      if (folderId) {
        if (isMongoReady()) {
          const folder = await Folder.findOne({ _id: folderId, userId: req.user.userId });
          if (!folder) {
            return res.status(404).json({ message: 'Folder not found.' });
          }
        } else {
          const folder = inMemoryFolders.find((item) => item.id === folderId);

          if (!folder) {
            return res.status(404).json({ message: 'Folder not found.' });
          }

          if (folder.userId !== req.user.userId) {
            return res.status(403).json({ message: 'You do not have permission to access this folder.' });
          }
        }

        resolvedFolderId = folderId;
      }

      const uploadData = await generateUploadUrl(
        req.user.userId,
        fileName,
        mimeType || 'application/octet-stream',
        size,
      );

      if (isMongoReady()) {
        const fileRecord = await File.create({
          userId: req.user.userId,
          originalName: fileName.trim(),
          fileName: uploadData.objectKey.split('/').pop(),
          s3Key: uploadData.objectKey,
          mimeType: mimeType || 'application/octet-stream',
          size: requestedSize, // reserve pending quota
          status: 'pending',
          folderId: resolvedFolderId,
          isStarred: false,
          isDeleted: false,
          deletedAt: null,
        });

        return res.status(200).json({
          message: 'Upload URL generated successfully.',
          ...uploadData,
          file: normalizeRecord(fileRecord),
        });
      }

      const fileRecord = {
        id: `file-${Date.now()}-${crypto.randomUUID()}`,
        userId: req.user.userId,
        originalName: fileName.trim(),
        fileName: uploadData.objectKey.split('/').pop(),
        s3Key: uploadData.objectKey,
        mimeType: mimeType || 'application/octet-stream',
        size: requestedSize, // reserve pending quota
        status: 'pending',
        folderId: resolvedFolderId,
        isStarred: false,
        isDeleted: false,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      inMemoryFiles.push(fileRecord);

      return res.status(200).json({
        message: 'Upload URL generated successfully.',
        ...uploadData,
        file: normalizeRecord(fileRecord),
      });
    });
  } catch (error) {
    next(error);
  }
};

const confirmUpload = async (req, res, next) => {
  try {
    const { fileId, size } = req.body;

    if (!fileId) {
      return res.status(400).json({ message: 'fileId is required.' });
    }

    if (!isValidUploadSize(size)) {
      return res.status(400).json({ message: 'Valid file size is required.' });
    }

    if (isMongoReady()) {
      const file = await File.findOne({ _id: fileId, userId: req.user.userId });
      if (!file) {
        return res.status(404).json({ message: 'File not found.' });
      }

      if (file.status !== 'pending') {
        return res.status(409).json({ message: 'File is not awaiting upload confirmation.' });
      }

      let storedObject;
      try {
        storedObject = await verifyS3Object(file.s3Key);
      } catch (error) {
        if (error.statusCode === 404) {
          await cleanupPendingRecord(req.user.userId, file, 'file');
          return res.status(404).json({ message: 'Uploaded file was not found in storage.' });
        }
        throw error;
      }

      const actualSize = storedObject ? storedObject.contentLength : size;
      if (await isOversizedObject(actualSize)) {
        await cleanupPendingRecord(req.user.userId, file, 'file');
        return res.status(413).json({ message: 'Uploaded file exceeds the maximum allowed size.' });
      }
      if (storedObject && actualSize !== size) {
        await cleanupPendingRecord(req.user.userId, file, 'file');
        return res.status(400).json({ message: 'Uploaded file size does not match the expected size.' });
      }

      // Check quota with actual size (excluding this file's previous reservation)
      const quota = await getUserQuota(req.user.userId, file.s3Key);
      const maxStorageBytes = getMaxUserStorageBytes();
      if (quota.usedStorageBytes + actualSize > maxStorageBytes) {
        await cleanupPendingRecord(req.user.userId, file, 'file');
        return res.status(413).json({
          message: `Storage limit reached. Uploaded file exceeds your limit of ${maxStorageBytes} bytes.`,
        });
      }

      file.size = actualSize;
      file.status = 'uploaded';
      file.updatedAt = new Date();
      await file.save();

      return res.status(200).json({
        message: 'File upload confirmed successfully.',
        file: normalizeRecord(file),
      });
    }

    const file = inMemoryFiles.find((item) => item.id === fileId);

    if (!file) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to update this file.' });
    }

    if (file.status !== 'pending') {
      return res.status(409).json({ message: 'File is not awaiting upload confirmation.' });
    }

    let storedObject;
    try {
      storedObject = await verifyS3Object(file.s3Key);
    } catch (error) {
      if (error.statusCode === 404) {
        await cleanupPendingRecord(req.user.userId, file, 'file');
        return res.status(404).json({ message: 'Uploaded file was not found in storage.' });
      }
      throw error;
    }

    const actualSize = storedObject ? storedObject.contentLength : size;
    if (await isOversizedObject(actualSize)) {
      await cleanupPendingRecord(req.user.userId, file, 'file');
      return res.status(413).json({ message: 'Uploaded file exceeds the maximum allowed size.' });
    }
    if (storedObject && actualSize !== size) {
      await cleanupPendingRecord(req.user.userId, file, 'file');
      return res.status(400).json({ message: 'Uploaded file size does not match the expected size.' });
    }

    // Check quota with actual size
    const quota = await getUserQuota(req.user.userId, file.s3Key);
    const maxStorageBytes = getMaxUserStorageBytes();
    if (quota.usedStorageBytes + actualSize > maxStorageBytes) {
      await cleanupPendingRecord(req.user.userId, file, 'file');
      return res.status(413).json({
        message: `Storage limit reached. Uploaded file exceeds your limit of ${maxStorageBytes} bytes.`,
      });
    }

    file.size = actualSize;
    file.status = 'uploaded';
    file.updatedAt = new Date().toISOString();

    return res.status(200).json({
      message: 'File upload confirmed successfully.',
      file: normalizeRecord(file),
    });
  } catch (error) {
    next(error);
  }
};

const updateFile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { originalName, folderId } = req.body || {};

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file || file.isDeleted) {
        return res.status(404).json({ message: 'File not found.' });
      }

      if (originalName !== undefined) {
        if (typeof originalName !== 'string' || !originalName.trim()) {
          return res.status(400).json({ message: 'File name is required.' });
        }

        if (originalName.trim().length > 255) {
          return res.status(400).json({ message: 'File name is too long.' });
        }

        file.originalName = originalName.trim();
      }

      if (folderId !== undefined) {
        const nextFolderId = folderId || null;

        if (nextFolderId) {
          const folder = await Folder.findOne({ _id: nextFolderId, userId: req.user.userId });
          if (!folder) {
            return res.status(404).json({ message: 'Folder not found.' });
          }
        }

        file.folderId = nextFolderId;
      }

      if (originalName === undefined && folderId === undefined) {
        return res.status(400).json({ message: 'No file updates provided.' });
      }

      file.updatedAt = new Date();
      await file.save();

      return res.status(200).json({
        message: 'File updated successfully.',
        file: normalizeRecord(file),
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);

    if (!file || file.isDeleted) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to update this file.' });
    }

    if (originalName !== undefined) {
      if (typeof originalName !== 'string' || !originalName.trim()) {
        return res.status(400).json({ message: 'File name is required.' });
      }

      if (originalName.trim().length > 255) {
        return res.status(400).json({ message: 'File name is too long.' });
      }

      file.originalName = originalName.trim();
    }

    if (folderId !== undefined) {
      const nextFolderId = folderId || null;

      if (nextFolderId) {
        const folder = inMemoryFolders.find((item) => item.id === nextFolderId && item.userId === req.user.userId);

        if (!folder) {
          return res.status(404).json({ message: 'Folder not found.' });
        }
      }

      file.folderId = nextFolderId;
    }

    if (originalName === undefined && folderId === undefined) {
      return res.status(400).json({ message: 'No file updates provided.' });
    }

    file.updatedAt = new Date().toISOString();

    return res.status(200).json({
      message: 'File updated successfully.',
      file: normalizeRecord(file),
    });
  } catch (error) {
    next(error);
  }
};

const createDownloadUrl = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file || file.isDeleted) {
        return res.status(404).json({ message: 'File not found.' });
      }

      const downloadUrl = await generateDownloadUrl(req.user.userId, file.s3Key);
      return res.status(200).json({
        message: 'Download URL generated successfully.',
        downloadUrl,
        file: normalizeRecord(file),
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);

    if (!file || file.isDeleted) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to access this file.' });
    }

    const downloadUrl = await generateDownloadUrl(req.user.userId, file.s3Key);

    return res.status(200).json({
      message: 'Download URL generated successfully.',
      downloadUrl,
      file: normalizeRecord(file),
    });
  } catch (error) {
    next(error);
  }
};

const isPreviewable = (mimeType = '', fileName = '') => {
  const type = (mimeType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();

  if (type === 'image/svg+xml' || type === 'text/html' || name.endsWith('.svg') || name.endsWith('.html') || name.endsWith('.htm')) {
    return false;
  }

  const safeMimeTypes = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
  ]);
  if (safeMimeTypes.has(type)) {
    return true;
  }

  if (!type || type === 'application/octet-stream') {
    return ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.wav']
      .some((extension) => name.endsWith(extension));
  }

  return false;
};

const previewFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file || file.isDeleted) {
        return res.status(404).json({ message: 'File not found.' });
      }

      const previewUrl = isPreviewable(file.mimeType, file.originalName)
        ? await generateDownloadUrl(req.user.userId, file.s3Key, 'inline')
        : null;

      return res.status(200).json({
        message: previewUrl ? 'Preview URL generated successfully.' : 'This file type is not previewable in the browser.',
        canPreview: Boolean(previewUrl),
        previewUrl,
        file: normalizeRecord(file),
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);

    if (!file || file.isDeleted) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to preview this file.' });
    }

    const previewUrl = isPreviewable(file.mimeType, file.originalName)
      ? await generateDownloadUrl(req.user.userId, file.s3Key, 'inline')
      : null;

    return res.status(200).json({
      message: previewUrl ? 'Preview URL generated successfully.' : 'This file type is not previewable in the browser.',
      canPreview: Boolean(previewUrl),
      previewUrl,
      file: normalizeRecord(file),
    });
  } catch (error) {
    next(error);
  }
};

const createShare = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { expiresInMinutes = 60 } = req.body || {};

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file || file.isDeleted) {
        return res.status(404).json({ message: 'File not found.' });
      }

      if (!isValidShareExpiry(expiresInMinutes)) {
        return res.status(400).json({ message: 'expiresInMinutes must be an integer between 1 and 10080.' });
      }

      const shareToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
      const shareUrl = createShareUrl(req, shareToken);

      const share = await Share.create({
        fileId: file.id,
        userId: req.user.userId,
        token: shareToken,
        shareUrl,
        expiresAt,
        isActive: true,
        downloads: 0,
      });

      return res.status(200).json({
        message: 'Share link created successfully.',
        share: {
          ...normalizeRecord(share),
          shareUrl,
        },
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);

    if (!file || file.isDeleted) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to share this file.' });
    }

    if (!isValidShareExpiry(expiresInMinutes)) {
      return res.status(400).json({ message: 'expiresInMinutes must be an integer between 1 and 10080.' });
    }

    const shareToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
    const shareUrl = createShareUrl(req, shareToken);

    const share = {
      id: `share-${Date.now()}`,
      fileId: file.id,
      userId: req.user.userId,
      token: shareToken,
      shareUrl,
      expiresAt,
      createdAt: new Date().toISOString(),
      isActive: true,
      downloads: 0,
    };

    inMemoryShares.push(share);

    return res.status(200).json({
      message: 'Share link created successfully.',
      share: {
        ...share,
        shareUrl,
      },
    });
  } catch (error) {
    next(error);
  }
};

const listSharedFiles = async (req, res, next) => {
  try {
    if (isMongoReady()) {
      const shares = await Share.find({ userId: req.user.userId, isActive: true });
      const sharedFiles = [];

      for (const share of shares) {
        const file = await File.findOne({ _id: share.fileId, userId: req.user.userId, isDeleted: { $ne: true } });
        if (file) {
          sharedFiles.push({
            share: {
              ...normalizeRecord(share),
              // Build the URL from the current production configuration so shares
              // created before a backend URL change are shown with the active host.
              shareUrl: createShareUrl(req, share.token),
            },
            file: normalizeRecord(file),
          });
        }
      }

      return res.status(200).json({ shares: sharedFiles });
    }

    const sharedFiles = inMemoryShares
      .filter((share) => share.userId === req.user.userId && share.isActive)
      .map((share) => {
        const file = inMemoryFiles.find((item) => item.id === share.fileId && item.userId === req.user.userId && !item.isDeleted);
        if (!file) return null;

        return {
          share: {
            ...normalizeRecord(share),
            shareUrl: createShareUrl(req, share.token),
          },
          file: normalizeRecord(file),
        };
      })
      .filter(Boolean);

    return res.status(200).json({ shares: sharedFiles });
  } catch (error) {
    next(error);
  }
};

const accessSharedFile = async (req, res, next) => {
  try {
    const { token } = req.params;

    if (isMongoReady()) {
      const share = await Share.findOne({ token, isActive: true });
      if (!share) {
        return res.status(404).json({ message: 'Shared file link is invalid or expired.' });
      }

      if (new Date(share.expiresAt).getTime() <= Date.now()) {
        share.isActive = false;
        await share.save();
        return res.status(410).json({ message: 'This shared file link has expired.' });
      }

      const file = await File.findOne({ _id: share.fileId, userId: share.userId });
      if (!file || file.isDeleted) {
        return res.status(404).json({ message: 'Shared file no longer exists.' });
      }

      share.downloads += 1;
      await share.save();
      const downloadUrl = await generateDownloadUrl(share.userId, file.s3Key);

      // The public share URL is the user-facing download link. Redirect each
      // visit to a freshly generated short-lived S3 URL instead of exposing
      // an API JSON payload in the browser.
      return res.redirect(302, downloadUrl);
    }

    const share = inMemoryShares.find((entry) => entry.token === token && entry.isActive);

    if (!share) {
      return res.status(404).json({ message: 'Shared file link is invalid or expired.' });
    }

    if (new Date(share.expiresAt).getTime() <= Date.now()) {
      share.isActive = false;
      return res.status(410).json({ message: 'This shared file link has expired.' });
    }

    const file = inMemoryFiles.find((item) => item.id === share.fileId);
    if (!file || file.isDeleted) {
      return res.status(404).json({ message: 'Shared file no longer exists.' });
    }

    share.downloads += 1;
    const downloadUrl = await generateDownloadUrl(share.userId, file.s3Key);

    return res.redirect(302, downloadUrl);
  } catch (error) {
    next(error);
  }
};

const createVersion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fileName, mimeType, size } = req.body || {};

    if (
      (size === undefined && process.env.NODE_ENV === 'production')
      || (size !== undefined && !isValidUploadSize(size))
    ) {
      return res.status(400).json({ message: 'Valid file size is required.' });
    }

    if (size !== undefined && size > getMaxUploadSizeBytes()) {
      return res.status(413).json({ message: 'File exceeds the maximum allowed size.' });
    }

    return await withUserQuotaLock(req.user.userId, async () => {
      await cleanupExpiredPendingForUser(req.user.userId);

      if (isMongoReady()) {
        const file = await File.findOne({ _id: id, userId: req.user.userId });
        if (!file || file.isDeleted) {
          return res.status(404).json({ message: 'File not found.' });
        }

        const quota = await getUserQuota(req.user.userId);
        const maxStorageBytes = getMaxUserStorageBytes();
        const requestedSize = Number(size) || 0;
        if (quota.usedStorageBytes + requestedSize > maxStorageBytes) {
          return res.status(413).json({
            message: `Storage limit reached. You have used ${quota.usedStorageBytes} of ${maxStorageBytes} bytes.`,
          });
        }

        const versionNumber = (await Version.countDocuments({
          fileId: file.id,
          userId: req.user.userId,
        })) + 1;
        const versionName = fileName || file.originalName;
        const uploadData = await generateUploadUrl(
          req.user.userId,
          versionName,
          mimeType || file.mimeType,
          size,
        );
        const versionRecord = await Version.create({
          fileId: file.id,
          userId: req.user.userId,
          versionNumber,
          originalName: versionName,
          fileName: uploadData.objectKey.split('/').pop(),
          s3Key: uploadData.objectKey,
          mimeType: mimeType || file.mimeType,
          size: requestedSize,
          status: 'pending',
        });

        return res.status(200).json({
          message: 'Version upload URL generated successfully.',
          ...uploadData,
          version: normalizeRecord(versionRecord),
        });
      }

      const file = inMemoryFiles.find((item) => item.id === id);
      if (!file || file.isDeleted) {
        return res.status(404).json({ message: 'File not found.' });
      }
      if (file.userId !== req.user.userId) {
        return res.status(403).json({ message: 'You do not have permission to update this file.' });
      }

      const quota = await getUserQuota(req.user.userId);
      const maxStorageBytes = getMaxUserStorageBytes();
      const requestedSize = Number(size) || 0;
      if (quota.usedStorageBytes + requestedSize > maxStorageBytes) {
        return res.status(413).json({
          message: `Storage limit reached. You have used ${quota.usedStorageBytes} of ${maxStorageBytes} bytes.`,
        });
      }

      const versionNumber = inMemoryVersions.filter((item) => item.fileId === id).length + 1;
      const versionName = fileName || file.originalName;
      const uploadData = await generateUploadUrl(
        req.user.userId,
        versionName,
        mimeType || file.mimeType,
        size,
      );
      const versionRecord = {
        id: `version-${Date.now()}-${crypto.randomUUID()}`,
        fileId: file.id,
        userId: req.user.userId,
        versionNumber,
        originalName: versionName,
        fileName: uploadData.objectKey.split('/').pop(),
        s3Key: uploadData.objectKey,
        mimeType: mimeType || file.mimeType,
        size: requestedSize,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      inMemoryVersions.push(versionRecord);

      return res.status(200).json({
        message: 'Version upload URL generated successfully.',
        ...uploadData,
        version: normalizeRecord(versionRecord),
      });
    });
  } catch (error) {
    next(error);
  }
};

const listVersions = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file || file.isDeleted) {
        return res.status(404).json({ message: 'File not found.' });
      }

      const versions = (await Version.find({ fileId: file.id, userId: req.user.userId }).sort({ versionNumber: -1 })).map(normalizeRecord);
      return res.status(200).json({
        fileId: id,
        versions,
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);

    if (!file || file.isDeleted) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to view versions for this file.' });
    }

    const versions = inMemoryVersions
      .filter((item) => item.fileId === id && item.userId === req.user.userId)
      .map(normalizeRecord)
      .sort((left, right) => right.versionNumber - left.versionNumber);

    return res.status(200).json({
      fileId: id,
      versions,
    });
  } catch (error) {
    next(error);
  }
};

const confirmVersion = async (req, res, next) => {
  try {
    const { id, versionId } = req.params;
    const { size } = req.body || {};

    if (isMongoReady()) {
      const parentFile = await File.findOne({ _id: id, userId: req.user.userId });
      if (!parentFile || parentFile.isDeleted) {
        return res.status(404).json({ message: 'File not found.' });
      }

      const version = await Version.findOne({ _id: versionId, fileId: id, userId: req.user.userId });
      if (!version) {
        return res.status(404).json({ message: 'Version not found.' });
      }

      if (!isValidUploadSize(size)) {
        return res.status(400).json({ message: 'Valid file size is required.' });
      }

      if (version.status !== 'pending') {
        return res.status(409).json({ message: 'Version is not awaiting upload confirmation.' });
      }

      let storedObject;
      try {
        storedObject = await verifyS3Object(version.s3Key);
      } catch (error) {
        if (error.statusCode === 404) {
          await cleanupPendingRecord(req.user.userId, version, 'version');
          return res.status(404).json({ message: 'Uploaded version was not found in storage.' });
        }
        throw error;
      }

      const actualSize = storedObject ? storedObject.contentLength : size;
      if (await isOversizedObject(actualSize)) {
        await cleanupPendingRecord(req.user.userId, version, 'version');
        return res.status(413).json({ message: 'Uploaded file exceeds the maximum allowed size.' });
      }
      if (storedObject && actualSize !== size) {
        await cleanupPendingRecord(req.user.userId, version, 'version');
        return res.status(400).json({ message: 'Uploaded file size does not match the expected size.' });
      }

      // Quota check with actual size
      const quota = await getUserQuota(req.user.userId, version.s3Key);
      const maxStorageBytes = getMaxUserStorageBytes();
      if (quota.usedStorageBytes + actualSize > maxStorageBytes) {
        await cleanupPendingRecord(req.user.userId, version, 'version');
        return res.status(413).json({
          message: `Storage limit reached. Uploaded file exceeds your limit of ${maxStorageBytes} bytes.`,
        });
      }

      version.size = actualSize;
      version.status = 'uploaded';
      version.updatedAt = new Date();
      await version.save();

      return res.status(200).json({
        message: 'Version upload confirmed successfully.',
        version: normalizeRecord(version),
      });
    }

    const parentFile = inMemoryFiles.find((item) => item.id === id);
    if (!parentFile || parentFile.isDeleted) {
      return res.status(404).json({ message: 'File not found.' });
    }

    const version = inMemoryVersions.find((item) => item.id === versionId && item.fileId === id && item.userId === req.user.userId);

    if (!version) {
      return res.status(404).json({ message: 'Version not found.' });
    }

    if (!isValidUploadSize(size)) {
      return res.status(400).json({ message: 'Valid file size is required.' });
    }

    if (version.status !== 'pending') {
      return res.status(409).json({ message: 'Version is not awaiting upload confirmation.' });
    }

    let storedObject;
    try {
      storedObject = await verifyS3Object(version.s3Key);
    } catch (error) {
      if (error.statusCode === 404) {
        await cleanupPendingRecord(req.user.userId, version, 'version');
        return res.status(404).json({ message: 'Uploaded version was not found in storage.' });
      }
      throw error;
    }

    const actualSize = storedObject ? storedObject.contentLength : size;
    if (await isOversizedObject(actualSize)) {
      await cleanupPendingRecord(req.user.userId, version, 'version');
      return res.status(413).json({ message: 'Uploaded file exceeds the maximum allowed size.' });
    }
    if (storedObject && actualSize !== size) {
      await cleanupPendingRecord(req.user.userId, version, 'version');
      return res.status(400).json({ message: 'Uploaded file size does not match the expected size.' });
    }

    // Quota check with actual size
    const quota = await getUserQuota(req.user.userId, version.s3Key);
    const maxStorageBytes = getMaxUserStorageBytes();
    if (quota.usedStorageBytes + actualSize > maxStorageBytes) {
      await cleanupPendingRecord(req.user.userId, version, 'version');
      return res.status(413).json({
        message: `Storage limit reached. Uploaded file exceeds your limit of ${maxStorageBytes} bytes.`,
      });
    }

    version.size = actualSize;
    version.status = 'uploaded';
    version.updatedAt = new Date().toISOString();

    return res.status(200).json({
      message: 'Version upload confirmed successfully.',
      version: normalizeRecord(version),
    });
  } catch (error) {
    next(error);
  }
};

const restoreVersion = async (req, res, next) => {
  try {
    const { id, versionId } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file || file.isDeleted) {
        return res.status(404).json({ message: 'File not found.' });
      }

      const version = await Version.findOne({ _id: versionId, fileId: id, userId: req.user.userId });
      if (!version) {
        return res.status(404).json({ message: 'Version not found.' });
      }

      if (version.status !== 'uploaded') {
        return res.status(409).json({ message: 'Version is not available for restoration.' });
      }

      const storedObject = await verifyS3Object(version.s3Key);
      if (!storedObject && process.env.NODE_ENV === 'production') {
        const error = new Error('File storage is temporarily unavailable.');
        error.statusCode = 503;
        throw error;
      }

      // Keep the current object in version history before switching to the selected version.
      // This prevents its S3 object from becoming orphaned and keeps it in quota accounting.
      if (file.s3Key && file.s3Key !== version.s3Key) {
        const currentObjectAlreadyVersioned = await Version.exists({
          fileId: file.id,
          userId: req.user.userId,
          s3Key: file.s3Key,
        });
        if (!currentObjectAlreadyVersioned) {
          const nextVersionNumber = (await Version.countDocuments({
            fileId: file.id,
            userId: req.user.userId,
          })) + 1;
          await Version.create({
            fileId: file.id,
            userId: req.user.userId,
            versionNumber: nextVersionNumber,
            originalName: file.originalName,
            fileName: file.fileName,
            s3Key: file.s3Key,
            mimeType: file.mimeType,
            size: file.size,
            status: 'uploaded',
          });
        }
      }

      file.originalName = version.originalName;
      file.fileName = version.fileName;
      file.s3Key = version.s3Key;
      file.mimeType = version.mimeType;
      file.size = version.size;
      file.status = 'restored';
      file.updatedAt = new Date();
      await file.save();

      return res.status(200).json({
        message: 'Version restored successfully.',
        file: normalizeRecord(file),
        version: normalizeRecord(version),
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id && item.userId === req.user.userId);
    if (!file || file.isDeleted) {
      return res.status(404).json({ message: 'File not found.' });
    }

    const version = inMemoryVersions.find((item) => item.id === versionId && item.fileId === id && item.userId === req.user.userId);

    if (!version) {
      return res.status(404).json({ message: 'Version not found.' });
    }

    if (version.status !== 'uploaded') {
      return res.status(409).json({ message: 'Version is not available for restoration.' });
    }

    const storedObject = await verifyS3Object(version.s3Key);
    if (!storedObject && process.env.NODE_ENV === 'production') {
      const error = new Error('File storage is temporarily unavailable.');
      error.statusCode = 503;
      throw error;
    }

    // Preserve the previous current object as a version before switching keys.
    if (file.s3Key && file.s3Key !== version.s3Key) {
      const currentObjectAlreadyVersioned = inMemoryVersions.some((item) => (
        item.fileId === file.id && item.userId === req.user.userId && item.s3Key === file.s3Key
      ));
      if (!currentObjectAlreadyVersioned) {
        const nextVersionNumber = inMemoryVersions
          .filter((item) => item.fileId === file.id && item.userId === req.user.userId)
          .reduce((maximum, item) => Math.max(maximum, item.versionNumber || 0), 0) + 1;
        inMemoryVersions.push({
          id: `version-${Date.now()}-${crypto.randomUUID()}`,
          fileId: file.id,
          userId: req.user.userId,
          versionNumber: nextVersionNumber,
          originalName: file.originalName,
          fileName: file.fileName,
          s3Key: file.s3Key,
          mimeType: file.mimeType,
          size: file.size,
          status: 'uploaded',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    file.originalName = version.originalName;
    file.fileName = version.fileName;
    file.s3Key = version.s3Key;
    file.mimeType = version.mimeType;
    file.size = version.size;
    file.status = 'restored';
    file.updatedAt = new Date().toISOString();

    return res.status(200).json({
      message: 'Version restored successfully.',
      file: normalizeRecord(file),
      version: normalizeRecord(version),
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete
const deleteFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file) {
        return res.status(404).json({ message: 'File not found.' });
      }

      // Soft delete: move to trash
      file.isDeleted = true;
      file.deletedAt = new Date();
      file.updatedAt = new Date();
      await file.save();

      // Deactivate active public share links
      await Share.updateMany({ fileId: file.id, userId: req.user.userId }, { $set: { isActive: false } });

      return res.status(200).json({
        message: 'File moved to trash.',
        fileId: id,
        file: normalizeRecord(file),
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);

    if (!file) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to delete this file.' });
    }

    file.isDeleted = true;
    file.deletedAt = new Date().toISOString();
    file.updatedAt = new Date().toISOString();

    // Deactivate active public share links
    for (const share of inMemoryShares) {
      if (share.fileId === id && share.userId === req.user.userId) {
        share.isActive = false;
      }
    }

    return res.status(200).json({
      message: 'File moved to trash.',
      fileId: id,
      file: normalizeRecord(file),
    });
  } catch (error) {
    next(error);
  }
};

const cancelUpload = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId, status: 'pending' });
      if (!file) {
        return res.status(404).json({ message: 'Pending upload not found.' });
      }

      await deleteS3Objects(req.user.userId, [file.s3Key]);
      await File.deleteOne({ _id: id, userId: req.user.userId, status: 'pending' });
      return res.status(200).json({ message: 'Upload reservation cancelled.' });
    }

    const index = inMemoryFiles.findIndex((item) => item.id === id && item.userId === req.user.userId && item.status === 'pending');
    if (index === -1) {
      return res.status(404).json({ message: 'Pending upload not found.' });
    }

    await deleteS3Objects(req.user.userId, [inMemoryFiles[index].s3Key]);
    inMemoryFiles.splice(index, 1);
    return res.status(200).json({ message: 'Upload reservation cancelled.' });
  } catch (error) {
    next(error);
  }
};

const cancelVersionUpload = async (req, res, next) => {
  try {
    const { id, versionId } = req.params;

    if (isMongoReady()) {
      const parentFile = await File.findOne({ _id: id, userId: req.user.userId });
      if (!parentFile) {
        return res.status(404).json({ message: 'File not found.' });
      }

      const version = await Version.findOne({
        _id: versionId,
        fileId: id,
        userId: req.user.userId,
        status: 'pending',
      });
      if (!version) {
        return res.status(404).json({ message: 'Pending version upload not found.' });
      }

      await deleteS3Objects(req.user.userId, [version.s3Key]);
      await Version.deleteOne({ _id: versionId, fileId: id, userId: req.user.userId, status: 'pending' });
      return res.status(200).json({ message: 'Version upload reservation cancelled.' });
    }

    const parentFile = inMemoryFiles.find((item) => item.id === id && item.userId === req.user.userId);
    if (!parentFile) {
      return res.status(404).json({ message: 'File not found.' });
    }

    const index = inMemoryVersions.findIndex((item) => (
      item.id === versionId
      && item.fileId === id
      && item.userId === req.user.userId
      && item.status === 'pending'
    ));
    if (index === -1) {
      return res.status(404).json({ message: 'Pending version upload not found.' });
    }

    await deleteS3Objects(req.user.userId, [inMemoryVersions[index].s3Key]);
    inMemoryVersions.splice(index, 1);
    return res.status(200).json({ message: 'Version upload reservation cancelled.' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserQuotaInfo,
  listFiles,
  listRecentFiles,
  listStarredFiles,
  toggleStar,
  listTrashFiles,
  restoreFile,
  permanentDeleteFile,
  createUploadUrl,
  confirmUpload,
  cancelUpload,
  cancelVersionUpload,
  updateFile,
  createDownloadUrl,
  previewFile,
  createShare,
  accessSharedFile,
  listSharedFiles,
  createVersion,
  listVersions,
  confirmVersion,
  restoreVersion,
  deleteFile,
};
