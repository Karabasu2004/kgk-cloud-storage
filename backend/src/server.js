require('dotenv').config();
const mongoose = require('mongoose');
const { createApp, connectDatabase } = require('./app');
const { getStorageStatus } = require('./config/database');
const { getAwsStatus } = require('./config/aws');
const { validateProductionConfig } = require('./config/productionConfig');

const validateRuntimeEnvironment = () => {
  validateProductionConfig();
  const storage = getStorageStatus();
  const aws = getAwsStatus();

  console.log('[SERVER] Runtime configuration summary:');
  console.log(`  - MongoDB: ${storage.configured ? 'configured' : 'missing MONGODB_URI'} | mode=${storage.mode}`);
  console.log(`  - AWS S3: ${aws.configured ? 'configured' : 'missing bucket/credentials'}`);

  if (process.env.NODE_ENV !== 'production' && !storage.configured) {
    console.warn('[SERVER] MongoDB is not configured; local development will use in-memory storage.');
  }
  if (process.env.NODE_ENV !== 'production' && !aws.configured) {
    console.warn('[SERVER] S3 is not configured; local development URLs will be used.');
  }
};

let shutdownPromise;

const shutdownServer = (server, signal) => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    console.log(`[SERVER] ${signal} received. Shutting down gracefully.`);
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();
  })();

  return shutdownPromise;
};

const registerShutdownHandlers = (server) => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      shutdownServer(server, signal).catch((error) => {
        console.error('[SERVER] Graceful shutdown failed.', {
          errorName: error.name || 'Error',
        });
        process.exitCode = 1;
      });
    });
  }
};

let startupStage = 'production configuration validation';

const startServer = async () => {
  startupStage = 'production configuration validation';
  validateRuntimeEnvironment();

  startupStage = 'MongoDB connection';
  await connectDatabase();

  startupStage = 'HTTP server startup';
  const app = createApp();
  const port = Number(process.env.PORT || 5000);

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, () => resolve(listener));
    listener.once('error', reject);
  });

  registerShutdownHandlers(server);

  startupStage = 'completed';

  console.log(`[SERVER] KGK Cloud Storage is listening on port ${port}.`);

  return server;
};

const redactStartupMessage = (message) => {
  let safeMessage = String(message || 'Unknown startup error');

  safeMessage = safeMessage.replace(
    /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
    '[REDACTED_MONGODB_URI]'
  );

  const secrets = [
    process.env.MONGODB_URI,
    process.env.JWT_SECRET,
    process.env.AWS_ACCESS_KEY_ID,
    process.env.AWS_SECRET_ACCESS_KEY,
  ].filter((value) => typeof value === 'string' && value.length > 0);

  for (const secret of secrets) {
    safeMessage = safeMessage.split(secret).join('[REDACTED]');
  }

  return safeMessage;
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error('[SERVER] Failed to start application.', {
      stage: startupStage,
      errorName: error.name || 'Error',
      errorCode: error.code || 'n/a',
      message: redactStartupMessage(error.message),
    });

    process.exitCode = 1;
  });
}

module.exports = {
  validateRuntimeEnvironment,
  startServer,
  shutdownServer,
};
