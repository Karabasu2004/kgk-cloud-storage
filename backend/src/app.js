const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { connectDatabase, getStorageStatus } = require('./config/database');
const { getAwsStatus } = require('./config/aws');
const { getFrontendOrigins } = require('./config/productionConfig');
const authRoutes = require('./routes/authRoutes');
const fileRoutes = require('./routes/fileRoutes');
const folderRoutes = require('./routes/folderRoutes');
const { notFoundHandler, errorHandler } = require('./middleware/errorMiddleware');

const createApp = () => {
  const app = express();
  const allowedOrigins = new Set(getFrontendOrigins());

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(helmet());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
          return callback(null, true);
        }

        const error = new Error('Origin is not allowed.');
        error.statusCode = 403;
        return callback(error);
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
  });
  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many authentication attempts. Please try again later.' },
  });

  app.use('/api', apiRateLimiter);
  app.get('/api/ready', (req, res) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const mongoReady = getStorageStatus().usingMongo;
    const s3Ready = getAwsStatus().configured;
    const ready = !isProduction || (mongoReady && s3Ready);

    return res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
    });
  });

  app.use('/api/auth', (req, res, next) => {
    if (req.method === 'POST' && ['/register', '/login'].includes(req.path)) {
      return authRateLimiter(req, res, next);
    }

    return next();
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/files', fileRoutes);
  app.use('/api/folders', folderRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = {
  createApp,
  connectDatabase,
};
