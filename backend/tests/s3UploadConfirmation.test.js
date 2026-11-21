const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_S3_BUCKET = 'kgk-cloud-storage-test-bucket';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';

const { createApp } = require('../src/app');
const { s3Client } = require('../src/config/aws');

const authHeaders = (token) => ({
  'Content-Type': 'application/json',
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

const registerUser = async (port, name, email) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'StrongPass123!' }),
  });
  assert.equal(response.status, 201);
  return response.json();
};

const createPendingUpload = async (port, token) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileName: 'upload.txt', mimeType: 'text/plain' }),
  });
  assert.equal(response.status, 200);
  return response.json();
};

const confirmUpload = async (port, token, fileId, size) => fetch(
  `http://127.0.0.1:${port}/api/files/confirm-upload`,
  {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileId, size }),
  }
);

const withS3Response = async (send, callback) => {
  const originalSend = s3Client.send;
  s3Client.send = send;

  try {
    await callback();
  } finally {
    s3Client.send = originalSend;
  }
};

test('upload confirmation verifies the S3 object and stores its actual size', async () => {
  await withS3Response(async (command) => {
    assert.equal(command.input.Bucket, 'kgk-cloud-storage-test-bucket');
    assert.match(command.input.Key, /^users\//);
    return { ContentLength: 128 };
  }, async () => {
    await withServer(async (port) => {
      const { token, user } = await registerUser(port, 'Alice', 's3-success@example.com');
      const upload = await createPendingUpload(port, token);
      const response = await confirmUpload(port, token, upload.file.id, 128);

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.file.status, 'uploaded');
      assert.equal(payload.file.size, 128);
      assert.equal(upload.file.userId, user.id);
    });
  });
});

test('upload confirmation does not mark a file uploaded when the S3 object is missing', async () => {
  await withS3Response(async (command) => {
    if (command.constructor.name === 'HeadObjectCommand') {
      const error = new Error('not found');
      error.name = 'NotFound';
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    }
    return {};
  }, async () => {
    await withServer(async (port) => {
      const { token } = await registerUser(port, 'Alice', 's3-missing@example.com');
      const upload = await createPendingUpload(port, token);
      const response = await confirmUpload(port, token, upload.file.id, 128);

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        message: 'Uploaded file was not found in storage.',
      });
      assert.equal(global.__kgkFiles.length, 0);
    });
  });
});

test('upload confirmation rejects an S3 object whose size differs from the expected size', async () => {
  await withS3Response(async () => ({ ContentLength: 127 }), async () => {
    await withServer(async (port) => {
      const { token } = await registerUser(port, 'Alice', 's3-size@example.com');
      const upload = await createPendingUpload(port, token);
      const response = await confirmUpload(port, token, upload.file.id, 128);

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        message: 'Uploaded file size does not match the expected size.',
      });
      assert.equal(global.__kgkFiles.length, 0);
    });
  });
});

test('upload confirmation prevents one user from confirming another user file', async () => {
  let headObjectCallCount = 0;
  await withS3Response(async () => {
    headObjectCallCount += 1;
    return { ContentLength: 128 };
  }, async () => {
    await withServer(async (port) => {
      const owner = await registerUser(port, 'Alice', 's3-owner@example.com');
      const otherUser = await registerUser(port, 'Bob', 's3-other@example.com');
      const upload = await createPendingUpload(port, owner.token);
      const response = await confirmUpload(port, otherUser.token, upload.file.id, 128);

      assert.equal(response.status, 403);
      assert.equal(headObjectCallCount, 0);
      assert.equal(global.__kgkFiles[0].status, 'pending');
    });
  });
});
