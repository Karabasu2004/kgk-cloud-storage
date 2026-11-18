const mongoose = require('mongoose');
const { inMemoryFolders, inMemoryFiles } = require('../config/database');
const { Folder, File } = require('../models');

const validateFolderName = (name) => {
  if (typeof name !== 'string' || !name.trim()) {
    return 'Folder name is required.';
  }

  if (name.trim().length > 100) {
    return 'Folder name is too long.';
  }

  return null;
};

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

const normalizeFolder = (folder) => {
  if (!folder) return null;
  const plain = folder.toObject ? folder.toObject() : folder;
  return {
    ...plain,
    id: plain.id || plain._id?.toString?.() || null,
  };
};

const findFolder = (userId, folderId) => {
  return inMemoryFolders.find((folder) => folder.id === folderId && folder.userId === userId);
};

const listFolders = async (req, res) => {
  if (isMongoReady()) {
    const userFolders = await Folder.find({ userId: req.user.userId }).sort({ name: 1 });
    return res.status(200).json({ folders: userFolders.map(normalizeFolder) });
  }

  const userFolders = inMemoryFolders
    .filter((folder) => folder.userId === req.user.userId)
    .sort((left, right) => left.name.localeCompare(right.name));

  return res.status(200).json({ folders: userFolders });
};

const createFolder = async (req, res) => {
  const { name, parentId } = req.body;
  const validationMessage = validateFolderName(name);

  if (validationMessage) {
    return res.status(400).json({ message: validationMessage });
  }

  if (parentId) {
    if (isMongoReady()) {
      const parentFolder = await Folder.findOne({ _id: parentId, userId: req.user.userId });
      if (!parentFolder) {
        return res.status(404).json({ message: 'Parent folder not found.' });
      }
    } else {
      const parentFolder = findFolder(req.user.userId, parentId);
      if (!parentFolder) {
        return res.status(404).json({ message: 'Parent folder not found.' });
      }
    }
  }

  if (isMongoReady()) {
    const newFolder = await Folder.create({
      userId: req.user.userId,
      name: name.trim(),
      parentId: parentId || null,
    });

    return res.status(201).json({
      message: 'Folder created successfully.',
      folder: normalizeFolder(newFolder),
    });
  }

  const newFolder = {
    id: `folder-${Date.now()}`,
    userId: req.user.userId,
    name: name.trim(),
    parentId: parentId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  inMemoryFolders.push(newFolder);

  return res.status(201).json({
    message: 'Folder created successfully.',
    folder: newFolder,
  });
};

const updateFolder = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const validationMessage = validateFolderName(name);

  if (validationMessage) {
    return res.status(400).json({ message: validationMessage });
  }

  if (isMongoReady()) {
    const folder = await Folder.findOne({ _id: id, userId: req.user.userId });
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found.' });
    }

    folder.name = name.trim();
    folder.updatedAt = new Date();
    await folder.save();

    return res.status(200).json({
      message: 'Folder updated successfully.',
      folder: normalizeFolder(folder),
    });
  }

  const folder = findFolder(req.user.userId, id);
  if (!folder) {
    return res.status(404).json({ message: 'Folder not found.' });
  }

  folder.name = name.trim();
  folder.updatedAt = new Date().toISOString();

  return res.status(200).json({
    message: 'Folder updated successfully.',
    folder,
  });
};

const deleteFolder = async (req, res) => {
  const { id } = req.params;

  if (isMongoReady()) {
    const folder = await Folder.findOne({ _id: id, userId: req.user.userId });
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found.' });
    }

    await Folder.deleteOne({ _id: id, userId: req.user.userId });
    await File.updateMany(
      { userId: req.user.userId, folderId: folder.id },
      { $set: { folderId: null, updatedAt: new Date() } }
    );

    return res.status(200).json({
      message: 'Folder deleted successfully.',
      folderId: folder.id,
    });
  }

  const folderIndex = inMemoryFolders.findIndex(
    (item) => item.id === id && item.userId === req.user.userId
  );

  if (folderIndex === -1) {
    return res.status(404).json({ message: 'Folder not found.' });
  }

  const folder = inMemoryFolders[folderIndex];

  inMemoryFolders.splice(folderIndex, 1);

  inMemoryFiles.forEach((file) => {
    if (file.userId === req.user.userId && file.folderId === folder.id) {
      file.folderId = null;
      file.updatedAt = new Date().toISOString();
    }
  });

  return res.status(200).json({
    message: 'Folder deleted successfully.',
    folderId: folder.id,
  });
};

module.exports = {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
};
