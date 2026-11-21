const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_S3_BUCKET = 'kgk-cloud-storage-test-bucket';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.FRONTEND_URL = 'http://localhost:5173';

const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { createApp } = require('../src/app');
const {
  validateProductionConfig,
  getMaxUploadSizeBytes,
  getPublicApiBaseUrl,
} = require('../src/config/productionConfig');
const { s3Client } = require('../src/config/aws');
const { errorHandler } = require('../src/middleware/errorMiddleware');

const envNames = [
  'NODE_ENV',
  'MONGODB_URI',
  'JWT_SECRET',
  'AWS_REGION',
  'AWS_S3_BUCKET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'FRONTEND_URL',
  'PUBLIC_API_BASE_URL',
  'MAX_UPLOAD_SIZE_BYTES',
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_SDK_LOAD_CONFIG',
];
const originalEnvironment = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

const authHeaders = (token, contentType = true) => ({
  ...(contentType ? { 'Content-Type': 'application/json' } : {}),
  Authorization: `Bearer ${token}`,
});

const resetStorage = () => {
  global.__kgkUsers.length = 0;
  global.__kgkFiles.length = 0;
  global.__kgkFolders.length = 0;
  global.__kgkShares.length = 0;
  global.__kgkVersions.length = 0;
};

const withServer = async (callback) => {
  resetStorage();
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

const registerUser = async (port, email = 'safety@example.com') => {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Safety Test', email, password: 'StrongPass123!' }),
  });
  assert.equal(response.status, 201);
  return response.json();
};

const createFile = async (port, token, name = 'test.txt', size = 1, mimeType = 'text/plain') => {
  const response = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileName: name, mimeType, size }),
  });
  assert.equal(response.status, 200);
  return response.json();
};

const withS3Send = async (send, callback) => {
  const originalSend = s3Client.send;
  s3Client.send = send;
  try {
    await callback();
  } finally {
    s3Client.send = originalSend;
  }
};

const setValidProductionEnvironment = () => {
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = 'mongodb://example.invalid:27017/kgk_test';
  process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-123456';
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_S3_BUCKET = 'test-bucket';
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.FRONTEND_URL = 'https://app.example.test';
  process.env.PUBLIC_API_BASE_URL = 'https://api.example.test/api';
};

test.after(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test('production configuration validates required settings and the public API URL', () => {
  setValidProductionEnvironment();
  assert.doesNotThrow(() => validateProductionConfig());

  delete process.env.AWS_S3_BUCKET;
  assert.throws(() => validateProductionConfig(), /AWS_S3_BUCKET/);

  setValidProductionEnvironment();
  process.env.PUBLIC_API_BASE_URL = 'https://api.example.test/api/';
  assert.throws(() => validateProductionConfig(), /without a trailing slash/);
});

test('production share URLs use the configured public API base rather than the request Host', () => {
  setValidProductionEnvironment();
  const request = {
    protocol: 'http',
    get: () => 'untrusted.example.test',
  };
  assert.equal(getPublicApiBaseUrl(request), 'https://api.example.test/api');

  process.env.NODE_ENV = 'development';
  assert.equal(getPublicApiBaseUrl(request), 'http://untrusted.example.test/api');
});

test('active HTML and SVG content is not considered safe for inline preview', async () => {
  process.env.NODE_ENV = 'test';
  await withServer(async (port) => {
    const user = await registerUser(port, 'active-preview@example.com');
    const html = await createFile(port, user.token, 'page.html', 1, 'text/html');
    const svg = await createFile(port, user.token, 'image.svg', 1, 'image/svg+xml');

    for (const file of [html, svg]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}/preview`, {
        headers: authHeaders(user.token),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.canPreview, false);
      assert.equal(payload.previewUrl, null);
    }
  });
});

test('upload size defaults to 50 MiB and accepts a positive integer override', () => {
  delete process.env.MAX_UPLOAD_SIZE_BYTES;
  assert.equal(getMaxUploadSizeBytes(), 50 * 1024 * 1024);
  process.env.MAX_UPLOAD_SIZE_BYTES = '1024';
  assert.equal(getMaxUploadSizeBytes(), 1024);
  process.env.MAX_UPLOAD_SIZE_BYTES = '1.5';
  assert.throws(() => getMaxUploadSizeBytes(), /positive integer/);
  delete process.env.MAX_UPLOAD_SIZE_BYTES;
});

test('presigned upload request includes the supplied object size in signed headers', async () => {
  process.env.NODE_ENV = 'test';
  await withServer(async (port) => {
    const user = await registerUser(port, 'signed-size@example.com');
    const file = await createFile(port, user.token, 'bounded.txt', 123);
    const signedHeaders = new URL(file.uploadUrl).searchParams.get('X-Amz-SignedHeaders');
    assert.match(signedHeaders, /content-length/);
    assert.equal(file.file.size, 123);
  });
});

test('upload URL creation rejects a declared size above the configured limit', async () => {
  process.env.NODE_ENV = 'test';
  process.env.MAX_UPLOAD_SIZE_BYTES = '10';
  await withServer(async (port) => {
    const user = await registerUser(port, 'oversize-request@example.com');
    const response = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'large.txt', mimeType: 'text/plain', size: 11 }),
    });
    assert.equal(response.status, 413);
    assert.equal(global.__kgkFiles.length, 0);
  });
});

test('share tokens are cryptographically shaped and expiration accepts only integer bounds', async () => {
  process.env.NODE_ENV = 'test';
  await withServer(async (port) => {
    const user = await registerUser(port, 'share-boundary@example.com');
    const file = await createFile(port, user.token);

    for (const expiresInMinutes of [0, -1, 1.5, 10081, '1']) {
      const rejected = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}/share`, {
        method: 'POST',
        headers: authHeaders(user.token),
        body: JSON.stringify({ expiresInMinutes }),
      });
      assert.equal(rejected.status, 400);
    }

    for (const expiresInMinutes of [1, 10080]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}/share`, {
        method: 'POST',
        headers: authHeaders(user.token),
        body: JSON.stringify({ expiresInMinutes }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      const token = payload.share.token;
      assert.match(token, /^[a-f0-9]{64}$/);
      assert.ok(payload.share.shareUrl.includes(`/api/files/shared/${token}`));
    }
  });
});

test('expired public share links are rejected', async () => {
  process.env.NODE_ENV = 'test';
  await withServer(async (port) => {
    const user = await registerUser(port, 'share-expired@example.com');
    const file = await createFile(port, user.token);
    const response = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}/share`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ expiresInMinutes: 1 }),
    });
    const payload = await response.json();
    global.__kgkShares[0].expiresAt = new Date(Date.now() - 1000).toISOString();

    const expired = await fetch(payload.share.shareUrl);
    assert.equal(expired.status, 410);
  });
});

test('oversized main uploads are deleted from S3 and release the pending reservation', async () => {
  process.env.NODE_ENV = 'test';
  process.env.MAX_UPLOAD_SIZE_BYTES = '10';
  await withServer(async (port) => {
    const user = await registerUser(port, 'oversize-main@example.com');
    const file = await createFile(port, user.token);
    let deletedKey;

    await withS3Send(async (command) => {
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: 11 };
      }
      if (command instanceof DeleteObjectCommand) {
        deletedKey = command.input.Key;
        return {};
      }
      throw new Error('Unexpected mocked S3 operation.');
    }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/files/confirm-upload`, {
        method: 'POST',
        headers: authHeaders(user.token),
        body: JSON.stringify({ fileId: file.file.id, size: 11 }),
      });
      assert.equal(response.status, 413);
    });

    assert.equal(deletedKey, file.file.s3Key);
    assert.equal(global.__kgkFiles.length, 0);
  });
  delete process.env.MAX_UPLOAD_SIZE_BYTES;
});

test('oversized version uploads are deleted from S3 and release the pending reservation', async () => {
  process.env.NODE_ENV = 'test';
  process.env.MAX_UPLOAD_SIZE_BYTES = '10';
  await withServer(async (port) => {
    const user = await registerUser(port, 'oversize-version@example.com');
    const file = await createFile(port, user.token);
    const versionResponse = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}/versions`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'version.txt', mimeType: 'text/plain', size: 1 }),
    });
    const versionData = await versionResponse.json();
    let deletedKey;

    await withS3Send(async (command) => {
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: 11 };
      }
      if (command instanceof DeleteObjectCommand) {
        deletedKey = command.input.Key;
        return {};
      }
      throw new Error('Unexpected mocked S3 operation.');
    }, async () => {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/files/${file.file.id}/versions/${versionData.version.id}/confirm`,
        {
          method: 'POST',
          headers: authHeaders(user.token),
          body: JSON.stringify({ size: 11 }),
        },
      );
      assert.equal(response.status, 413);
    });

    assert.equal(deletedKey, versionData.objectKey);
    assert.equal(global.__kgkVersions.length, 0);
  });
  delete process.env.MAX_UPLOAD_SIZE_BYTES;
});

test('file deletion deduplicates main and version S3 keys before removing metadata', async () => {
  process.env.NODE_ENV = 'test';
  await withServer(async (port) => {
    const user = await registerUser(port, 'delete-dedupe@example.com');
    const file = await createFile(port, user.token);
    const versionResponse = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}/versions`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'version.txt', mimeType: 'text/plain', size: 1 }),
    });
    const versionData = await versionResponse.json();
    global.__kgkVersions[0].s3Key = file.file.s3Key;
    const trashResponse = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}`, {
      method: 'DELETE',
      headers: authHeaders(user.token, false),
    });
    assert.equal(trashResponse.status, 200);

    const deletedKeys = [];
    await withS3Send(async (command) => {
      assert.ok(command instanceof DeleteObjectCommand);
      deletedKeys.push(command.input.Key);
      return {};
    }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}/permanent`, {
        method: 'DELETE',
        headers: authHeaders(user.token, false),
      });
      assert.equal(response.status, 200);
    });

    assert.equal(deletedKeys.length, 1);
    assert.equal(deletedKeys[0], file.file.s3Key);
    assert.equal(global.__kgkFiles.length, 0);
    assert.equal(global.__kgkVersions.length, 0);
    assert.ok(versionData.version.id);
  });
});

test('S3 deletion failure preserves file, share, and version metadata for retry', async () => {
  process.env.NODE_ENV = 'test';
  await withServer(async (port) => {
    const user = await registerUser(port, 'delete-failure@example.com');
    const file = await createFile(port, user.token);
    const versionResponse = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}/versions`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'version.txt', mimeType: 'text/plain', size: 1 }),
    });
    await versionResponse.json();
    global.__kgkShares.push({ id: 'share-1', fileId: file.file.id, userId: user.user.id, isActive: true });

    const trashResponse = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}`, {
      method: 'DELETE',
      headers: authHeaders(user.token, false),
    });
    assert.equal(trashResponse.status, 200);
    assert.equal(global.__kgkShares[0].isActive, false);

    let callCount = 0;
    await withS3Send(async () => {
      callCount += 1;
      if (callCount === 2) throw new Error('mocked S3 deletion failure');
      return {};
    }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/files/${file.file.id}/permanent`, {
        method: 'DELETE',
        headers: authHeaders(user.token, false),
      });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        message: 'Unable to delete file from storage. Please retry.',
      });
    });

    assert.equal(global.__kgkFiles.length, 1);
    assert.equal(global.__kgkVersions.length, 1);
    assert.equal(global.__kgkShares.length, 1);
  });
});

test('API security middleware sets headers, rejects unknown origins, and limits auth attempts', async () => {
  process.env.NODE_ENV = 'test';
  await withServer(async (port) => {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:5173');

    const disallowed = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Origin: 'https://unapproved.example.test' },
    });
    assert.equal(disallowed.status, 403);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 400);
    }
    const limited = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(limited.status, 429);
  });
});

test('production readiness reports unavailable dependencies without exposing details', async () => {
  process.env.NODE_ENV = 'production';
  process.env.FRONTEND_URL = 'https://app.example.test';
  await withServer(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'not_ready' });
  });
});

test('production error responses hide unexpected internal messages while preserving client errors', () => {
  process.env.NODE_ENV = 'production';
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const request = { method: 'GET', path: '/api/test' };

  errorHandler(new Error('internal diagnostic'), request, response, () => {});
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { message: 'Something went wrong on the server.' });

  const clientResponse = { ...response, statusCode: null, body: null };
  errorHandler(
    Object.assign(new Error('Safe validation message.'), { statusCode: 400 }),
    request,
    clientResponse,
    () => {},
  );
  assert.deepEqual(clientResponse.body, { message: 'Safe validation message.' });
});

test.afterEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.MAX_UPLOAD_SIZE_BYTES;
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_S3_BUCKET = 'kgk-cloud-storage-test-bucket';
  process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.FRONTEND_URL = 'http://localhost:5173';
});
