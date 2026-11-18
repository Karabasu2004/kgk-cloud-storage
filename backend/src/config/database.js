const mongoose = require('mongoose');
const { User, File, Folder, Share, Version } = require('../models');

const isProduction = process.env.NODE_ENV === 'production';

global.__kgkUsers = global.__kgkUsers || [];
global.__kgkFiles = global.__kgkFiles || [];
global.__kgkFolders = global.__kgkFolders || [];
global.__kgkShares = global.__kgkShares || [];
global.__kgkVersions = global.__kgkVersions || [];

const inMemoryUsers = global.__kgkUsers;
const inMemoryFiles = global.__kgkFiles;
const inMemoryFolders = global.__kgkFolders;
const inMemoryShares = global.__kgkShares;
const inMemoryVersions = global.__kgkVersions;

const isMongoConfigured = Boolean(process.env.MONGODB_URI && process.env.MONGODB_URI.trim());

const getStorageStatus = () => {
  const usingMongo = mongoose.connection.readyState === 1;

  return {
    configured: isMongoConfigured,
    usingMongo,
    mode: usingMongo ? 'mongo' : isMongoConfigured ? 'mongo-pending' : 'memory',
    missing: {
      uri: !isMongoConfigured,
    },
  };
};

const getMongoStatus = () => ({
  configured: isMongoConfigured,
  ready: mongoose.connection.readyState === 1,
  uri: process.env.MONGODB_URI ? 'configured' : 'missing',
});

const connectDatabase = async () => {
  if (!isMongoConfigured) {
    if (isProduction) {
      const error = new Error('MONGODB_URI is required in production mode.');
      console.error('[DB] Production mode requires MongoDB configuration. Startup aborted.');
      throw error;
    }

    console.warn('[DB] MONGODB_URI not configured. Using in-memory fallback for local development.');
    return { ok: true, mode: 'memory', usingMongo: false, configured: false };
  }

  try {
    if (mongoose.connection.readyState === 1) {
      console.log('[DB] MongoDB already connected.');
      return { ok: true, mode: 'mongo', usingMongo: true, configured: true };
    }

    mongoose.set('strictQuery', true);
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log('[DB] MongoDB connected successfully.');
    return { ok: true, mode: 'mongo', usingMongo: true, configured: true };
  } catch (error) {
    if (isProduction) {
      console.error('[DB] Production mode requires a working MongoDB connection. Startup aborted.');
      throw error;
    }

    console.error('[DB] MongoDB connection failed:', error.message);
    console.warn('[DB] Falling back to in-memory storage for local development.');
    return { ok: true, mode: 'memory', usingMongo: false, configured: true, warning: error.message };
  }
};

module.exports = {
  connectDatabase,
  getStorageStatus,
  getMongoStatus,
  isMongoConfigured,
  User,
  File,
  Folder,
  Share,
  Version,
  inMemoryUsers,
  inMemoryFiles,
  inMemoryFolders,
  inMemoryShares,
  inMemoryVersions,
};
