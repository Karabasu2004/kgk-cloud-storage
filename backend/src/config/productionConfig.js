const { validateJwtConfiguration } = require('./jwt');

const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_SIZE_ENV = 'MAX_UPLOAD_SIZE_BYTES';

const getFrontendOrigins = () => {
  const configuredOrigins = process.env.FRONTEND_URL;
  const originValues = configuredOrigins
    ? configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean)
    : process.env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:5173'];

  return [...new Set(originValues.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('FRONTEND_URL must contain comma-separated absolute origins.');
    }

    const isLocalhost = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      (process.env.NODE_ENV === 'production' && !isLocalhost && parsed.protocol !== 'https:')
    ) {
      throw new Error('FRONTEND_URL must contain exact origins without paths or wildcards.');
    }

    return parsed.origin;
  }))];
};

const getMaxUploadSizeBytes = () => {
  const configuredValue = process.env[MAX_UPLOAD_SIZE_ENV];
  if (configuredValue === undefined || configuredValue === '') {
    return DEFAULT_MAX_UPLOAD_SIZE_BYTES;
  }

  const size = Number(configuredValue);
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error('MAX_UPLOAD_SIZE_BYTES must be a positive integer.');
  }

  return size;
};

const getPublicApiBaseUrl = (req) => (
  process.env.NODE_ENV === 'production'
    ? process.env.PUBLIC_API_BASE_URL
    : `${req.protocol}://${req.get('host')}/api`
);

const validateProductionConfig = () => {
  if (
    process.env.NODE_ENV &&
    !['production', 'development', 'test'].includes(process.env.NODE_ENV)
  ) {
    throw new Error('NODE_ENV must be production, development, or test.');
  }

  if (process.env.NODE_ENV !== 'production') {
    getFrontendOrigins();
    getMaxUploadSizeBytes();
    return;
  }
  validateJwtConfiguration();

  const requiredNames = [
    'MONGODB_URI',
    'AWS_REGION',
    'AWS_S3_BUCKET',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'FRONTEND_URL',
    'PUBLIC_API_BASE_URL',
  ];
  const missingNames = requiredNames.filter((name) => {
    const value = process.env[name];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missingNames.length) {
    throw new Error(`Missing required production settings: ${missingNames.join(', ')}.`);
  }

  getFrontendOrigins();
  getMaxUploadSizeBytes();

  let publicApiUrl;
  try {
    publicApiUrl = new URL(process.env.PUBLIC_API_BASE_URL);
  } catch {
    throw new Error('PUBLIC_API_BASE_URL must be an absolute HTTPS URL ending in /api.');
  }

  if (
    publicApiUrl.protocol !== 'https:' ||
    publicApiUrl.username ||
    publicApiUrl.password ||
    publicApiUrl.pathname !== '/api' ||
    publicApiUrl.search ||
    publicApiUrl.hash ||
    process.env.PUBLIC_API_BASE_URL.endsWith('/')
  ) {
    throw new Error('PUBLIC_API_BASE_URL must be an absolute HTTPS URL ending in /api without a trailing slash.');
  }
};

module.exports = {
  DEFAULT_MAX_UPLOAD_SIZE_BYTES,
  getFrontendOrigins,
  getMaxUploadSizeBytes,
  getPublicApiBaseUrl,
  validateProductionConfig,
};
