const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;

const { validateRuntimeEnvironment } = require('../src/server');
const { getJwtSecret, validateJwtConfiguration } = require('../src/config/jwt');
const { createApp } = require('../src/app');

const setProductionEnvironment = (secret) => {
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = 'mongodb://example.invalid:27017/kgk_test';
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_S3_BUCKET = 'test-bucket';
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.FRONTEND_URL = 'https://app.example.test';
  process.env.PUBLIC_API_BASE_URL = 'https://api.example.test/api';
  if (secret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = secret;
  }
};

const setEnvironment = (nodeEnv, secret) => {
  process.env.NODE_ENV = nodeEnv;
  if (secret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = secret;
  }
};

const withServer = async (callback) => {
  const server = createApp().listen(0);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    await callback(server.address().port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

test.after(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

test('production startup validation rejects a missing JWT_SECRET', () => {
  setProductionEnvironment(undefined);
  assert.throws(
    () => validateRuntimeEnvironment(),
    { message: 'JWT_SECRET is required in production.' },
  );
});

test('production startup validation rejects a weak JWT_SECRET', () => {
  setProductionEnvironment('short-test-secret');
  assert.throws(
    () => validateRuntimeEnvironment(),
    { message: 'JWT_SECRET must be at least 32 bytes in production.' },
  );
});

test('production startup validation accepts a secret of at least 32 bytes', () => {
  setProductionEnvironment('a'.repeat(32));
  assert.doesNotThrow(() => validateRuntimeEnvironment());
  assert.doesNotThrow(() => validateJwtConfiguration());
});

test('JWT signing and verification use the configured secret and retain seven-day expiry', async () => {
  setEnvironment('test', 'test-configured-secret-with-sufficient-length');
  global.__kgkUsers.length = 0;

  await withServer(async (port) => {
    const registration = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'JWT Test User',
        email: 'jwt-config-test@example.com',
        password: 'StrongPass123!',
      }),
    });

    assert.equal(registration.status, 201);
    const registrationPayload = await registration.json();
    const decoded = jwt.verify(registrationPayload.token, getJwtSecret());
    assert.equal(decoded.email, 'jwt-config-test@example.com');
    assert.equal(decoded.exp - decoded.iat, 7 * 24 * 60 * 60);

    const currentUser = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: { Authorization: `Bearer ${registrationPayload.token}` },
    });
    assert.equal(currentUser.status, 200);
  });
});

test('development remains functional without JWT_SECRET using the development-only fallback', () => {
  setEnvironment('development', undefined);
  assert.equal(getJwtSecret(), 'kgk-dev-secret');
  assert.doesNotThrow(() => validateJwtConfiguration());
});
