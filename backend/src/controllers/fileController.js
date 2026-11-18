const mongoose = require('mongoose');
const crypto = require('node:crypto');
const { inMemoryFiles, inMemoryFolders, inMemoryShares, inMemoryVersions } = require('../config/database');
const { File, Folder, Share, Version } = require('../models');
const {
  getMaxUploadSizeBytes,
  getPublicApiBaseUrl,
} = require('../config/productionConfig');
const {
  generateUploadUrl,
  generateDownloadUrl,
  verifyS3Object,
  deleteS3Objects,
} = require('../services/s3Service');

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

const normalizeRecord = (record) => {
  if (!record) return null;

  const plain = record.toObject ? record.toObject() : record;
  const recordId = plain.id || plain._id?.toString?.() || null;

  return {
    ...plain,
    id: recordId,
  };
};

const isValidUploadSize = (size) => Number.isSafeInteger(size) && size >= 0;

const removeOversizedObject = async (userId, objectKey, actualSize) => {
  if (actualSize <= getMaxUploadSizeBytes()) {
    return false;
  }

  await deleteS3Objects(userId, [objectKey]);
  return true;
};

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

const listFiles = async (req, res, next) => {
  try {
    const { search = '', type = '', sortBy = 'createdAt', order = 'desc', folderId = '' } = req.query;

    const normalizedSearch = String(search).trim().toLowerCase();
    const normalizedType = String(type).trim().toLowerCase();
    const normalizedSort = ['name', 'size', 'createdAt'].includes(sortBy) ? sortBy : 'createdAt';
    const normalizedOrder = order === 'asc' ? 'asc' : 'desc';

    if (isMongoReady()) {
      const query = { userId: req.user.userId };
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

    let userFiles = inMemoryFiles.filter((file) => file.userId === req.user.userId);

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
        size: 0,
        status: 'pending',
        folderId: resolvedFolderId,
      });

      return res.status(200).json({
        message: 'Upload URL generated successfully.',
        ...uploadData,
        file: normalizeRecord(fileRecord),
      });
    }

    const fileRecord = {
      id: `file-${Date.now()}`,
      userId: req.user.userId,
      originalName: fileName.trim(),
      fileName: uploadData.objectKey.split('/').pop(),
      s3Key: uploadData.objectKey,
      mimeType: mimeType || 'application/octet-stream',
      size: 0,
      status: 'pending',
      folderId: resolvedFolderId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    inMemoryFiles.push(fileRecord);

    return res.status(200).json({
      message: 'Upload URL generated successfully.',
      ...uploadData,
      file: fileRecord,
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

      const storedObject = await verifyS3Object(file.s3Key);
      if (!storedObject && process.env.NODE_ENV === 'production') {
        const error = new Error('File storage is temporarily unavailable.');
        error.statusCode = 503;
        throw error;
      }

      const actualSize = storedObject ? storedObject.contentLength : size;
      if (await removeOversizedObject(req.user.userId, file.s3Key, actualSize)) {
        return res.status(413).json({ message: 'Uploaded file exceeds the maximum allowed size.' });
      }
      if (storedObject && actualSize !== size) {
        return res.status(400).json({ message: 'Uploaded file size does not match the expected size.' });
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

    const storedObject = await verifyS3Object(file.s3Key);
    if (!storedObject && process.env.NODE_ENV === 'production') {
      const error = new Error('File storage is temporarily unavailable.');
      error.statusCode = 503;
      throw error;
    }

    const actualSize = storedObject ? storedObject.contentLength : size;
    if (await removeOversizedObject(req.user.userId, file.s3Key, actualSize)) {
      return res.status(413).json({ message: 'Uploaded file exceeds the maximum allowed size.' });
    }
    if (storedObject && actualSize !== size) {
      return res.status(400).json({ message: 'Uploaded file size does not match the expected size.' });
    }

    file.size = actualSize;
    file.status = 'uploaded';
    file.updatedAt = new Date().toISOString();

    return res.status(200).json({
      message: 'File upload confirmed successfully.',
      file,
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
      if (!file) {
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

    if (!file) {
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
      file,
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
      if (!file) {
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

    if (!file) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to access this file.' });
    }

    const downloadUrl = await generateDownloadUrl(req.user.userId, file.s3Key);

    return res.status(200).json({
      message: 'Download URL generated successfully.',
      downloadUrl,
      file,
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
      if (!file) {
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

    if (!file) {
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
      file,
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
      if (!file) {
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

    if (!file) {
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
        const file = await File.findOne({ _id: share.fileId, userId: req.user.userId });
        if (file) {
          sharedFiles.push({
            ...normalizeRecord(share),
            file: normalizeRecord(file),
          });
        }
      }

      return res.status(200).json({ shares: sharedFiles });
    }

    const sharedFiles = inMemoryShares
      .filter((share) => share.userId === req.user.userId && share.isActive)
      .map((share) => {
        const file = inMemoryFiles.find((item) => item.id === share.fileId && item.userId === req.user.userId);
        return {
          ...share,
          file,
        };
      })
      .filter((entry) => entry.file);

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
      if (!file) {
        return res.status(404).json({ message: 'Shared file no longer exists.' });
      }

      share.downloads += 1;
      await share.save();
      const downloadUrl = await generateDownloadUrl(share.userId, file.s3Key);

      return res.status(200).json({
        message: 'Shared file access granted.',
        downloadUrl,
        file: normalizeRecord(file),
        share: normalizeRecord(share),
      });
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
    if (!file) {
      return res.status(404).json({ message: 'Shared file no longer exists.' });
    }

    share.downloads += 1;
    const downloadUrl = await generateDownloadUrl(share.userId, file.s3Key);

    return res.status(200).json({
      message: 'Shared file access granted.',
      downloadUrl,
      file,
      share,
    });
  } catch (error) {
    next(error);
  }
};

const createVersion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fileName, mimeType, size } = req.body || {};

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file) {
        return res.status(404).json({ message: 'File not found.' });
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

      const versionNumber = (await Version.countDocuments({ fileId: file.id, userId: req.user.userId })) + 1;
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
        size: 0,
        status: 'pending',
      });

      return res.status(200).json({
        message: 'Version upload URL generated successfully.',
        ...uploadData,
        version: normalizeRecord(versionRecord),
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);

    if (!file) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to update this file.' });
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

    const versionNumber = inMemoryVersions.filter((item) => item.fileId === id).length + 1;
    const versionName = fileName || file.originalName;
    const uploadData = await generateUploadUrl(
      req.user.userId,
      versionName,
      mimeType || file.mimeType,
      size,
    );

    const versionRecord = {
      id: `version-${Date.now()}`,
      fileId: file.id,
      userId: req.user.userId,
      versionNumber,
      originalName: versionName,
      fileName: uploadData.objectKey.split('/').pop(),
      s3Key: uploadData.objectKey,
      mimeType: mimeType || file.mimeType,
      size: 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    inMemoryVersions.push(versionRecord);

    return res.status(200).json({
      message: 'Version upload URL generated successfully.',
      ...uploadData,
      version: versionRecord,
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
      if (!file) {
        return res.status(404).json({ message: 'File not found.' });
      }

      const versions = (await Version.find({ fileId: file.id, userId: req.user.userId }).sort({ versionNumber: -1 })).map(normalizeRecord);
      return res.status(200).json({
        fileId: id,
        versions,
      });
    }

    const file = inMemoryFiles.find((item) => item.id === id);

    if (!file) {
      return res.status(404).json({ message: 'File not found.' });
    }

    if (file.userId !== req.user.userId) {
      return res.status(403).json({ message: 'You do not have permission to view versions for this file.' });
    }

    const versions = inMemoryVersions
      .filter((item) => item.fileId === id && item.userId === req.user.userId)
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

      const storedObject = await verifyS3Object(version.s3Key);
      if (!storedObject && process.env.NODE_ENV === 'production') {
        const error = new Error('File storage is temporarily unavailable.');
        error.statusCode = 503;
        throw error;
      }

      const actualSize = storedObject ? storedObject.contentLength : size;
      if (await removeOversizedObject(req.user.userId, version.s3Key, actualSize)) {
        return res.status(413).json({ message: 'Uploaded file exceeds the maximum allowed size.' });
      }
      if (storedObject && actualSize !== size) {
        return res.status(400).json({ message: 'Uploaded file size does not match the expected size.' });
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

    const storedObject = await verifyS3Object(version.s3Key);
    if (!storedObject && process.env.NODE_ENV === 'production') {
      const error = new Error('File storage is temporarily unavailable.');
      error.statusCode = 503;
      throw error;
    }

    const actualSize = storedObject ? storedObject.contentLength : size;
    if (await removeOversizedObject(req.user.userId, version.s3Key, actualSize)) {
      return res.status(413).json({ message: 'Uploaded file exceeds the maximum allowed size.' });
    }
    if (storedObject && actualSize !== size) {
      return res.status(400).json({ message: 'Uploaded file size does not match the expected size.' });
    }

    version.size = actualSize;
    version.status = 'uploaded';
    version.updatedAt = new Date().toISOString();

    return res.status(200).json({
      message: 'Version upload confirmed successfully.',
      version,
    });
  } catch (error) {
    next(error);
  }
};

const restoreVersion = async (req, res, next) => {
  try {
    const { id, versionId } = req.params;

    if (isMongoReady()) {
      const version = await Version.findOne({ _id: versionId, fileId: id, userId: req.user.userId });
      if (!version) {
        return res.status(404).json({ message: 'Version not found.' });
      }

      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file) {
        return res.status(404).json({ message: 'File not found.' });
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

    const version = inMemoryVersions.find((item) => item.id === versionId && item.fileId === id && item.userId === req.user.userId);

    if (!version) {
      return res.status(404).json({ message: 'Version not found.' });
    }

    const file = inMemoryFiles.find((item) => item.id === id && item.userId === req.user.userId);
    if (!file) {
      return res.status(404).json({ message: 'File not found.' });
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

    file.originalName = version.originalName;
    file.fileName = version.fileName;
    file.s3Key = version.s3Key;
    file.mimeType = version.mimeType;
    file.size = version.size;
    file.status = 'restored';
    file.updatedAt = new Date().toISOString();

    return res.status(200).json({
      message: 'Version restored successfully.',
      file,
      version,
    });
  } catch (error) {
    next(error);
  }
};

const deleteFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (isMongoReady()) {
      const file = await File.findOne({ _id: id, userId: req.user.userId });
      if (!file) {
        return res.status(404).json({ message: 'File not found.' });
      }

      const versions = await Version.find({ fileId: file.id, userId: req.user.userId });
      await deleteS3Objects(
        req.user.userId,
        [file.s3Key, ...versions.map((version) => version.s3Key)],
      );

      await Share.deleteMany({ fileId: file.id, userId: req.user.userId });
      await Version.deleteMany({ fileId: file.id, userId: req.user.userId });
      await File.deleteOne({ _id: id, userId: req.user.userId });

      return res.status(200).json({
        message: 'File deleted successfully.',
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

    const versions = inMemoryVersions.filter(
      (version) => version.fileId === id && version.userId === req.user.userId,
    );
    await deleteS3Objects(
      req.user.userId,
      [file.s3Key, ...versions.map((version) => version.s3Key)],
    );

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
      message: 'File deleted successfully.',
      fileId: id,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listFiles,
  createUploadUrl,
  confirmUpload,
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
