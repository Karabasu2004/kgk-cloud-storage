const DEVELOPMENT_JWT_SECRET = 'kgk-dev-secret';
const MIN_JWT_SECRET_BYTES = 32;

const validateJwtConfiguration = () => {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error('JWT_SECRET is required in production.');
  }

  if (Buffer.byteLength(secret, 'utf8') < MIN_JWT_SECRET_BYTES) {
    throw new Error('JWT_SECRET must be at least 32 bytes in production.');
  }
};

const getJwtSecret = () => {
  if (process.env.NODE_ENV === 'production') {
    validateJwtConfiguration();
    return process.env.JWT_SECRET;
  }

  return process.env.JWT_SECRET || DEVELOPMENT_JWT_SECRET;
};

module.exports = {
  getJwtSecret,
  validateJwtConfiguration,
};
