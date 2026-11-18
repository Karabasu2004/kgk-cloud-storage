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

const createFile = async (port, token, fileName, mimeType) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileName, mimeType }),
  });
  assert.equal(response.status, 200);
  return response.json();
};

const createVersion = async (port, token, fileId, fileName = 'version.txt') => {
  const response = await fetch(`http://127.0.0.1:${port}/api/files/${fileId}/versions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileName, mimeType: 'text/plain' }),
  });
  assert.equal(response.status, 200);
  return response.json();
};

const withS3Response = async (send, callback) => {
  const originalSend = s3Client.send;
  s3Client.send = send;

  try {
    await callback();
  } finally {
    s3Client.send = originalSend;
  }
};

const requestVersion = (port, token, fileId, versionId, path, body) => fetch(
  `http://127.0.0.1:${port}/api/files/${fileId}/versions/${versionId}/${path}`,
  {
    method: 'POST',
    headers: authHeaders(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  },
);

test('preview URLs are inline for images and PDFs, downloads remain attachments, and DOCX is unsupported', async () => {
  await withServer(async (port) => {
    const { token } = await registerUser(port, 'Alice', 'preview-disposition@example.com');
    const pdf = await createFile(port, token, 'report.pdf', 'application/pdf');
    const image = await createFile(port, token, 'photo.png', 'image/png');
    const docx = await createFile(
      port,
      token,
      'document.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    for (const upload of [pdf, image]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}/preview`, {
        headers: authHeaders(token),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.canPreview, true);
      assert.match(new URL(payload.previewUrl).searchParams.get('response-content-disposition'), /^inline;/);
    }

    const downloadResponse = await fetch(`http://127.0.0.1:${port}/api/files/${pdf.file.id}/download-url`, {
      headers: authHeaders(token),
    });
    assert.equal(downloadResponse.status, 200);
    const downloadPayload = await downloadResponse.json();
    assert.match(new URL(downloadPayload.downloadUrl).searchParams.get('response-content-disposition'), /^attachment;/);

    const docxResponse = await fetch(`http://127.0.0.1:${port}/api/files/${docx.file.id}/preview`, {
      headers: authHeaders(token),
    });
    assert.equal(docxResponse.status, 200);
    const docxPayload = await docxResponse.json();
    assert.equal(docxPayload.canPreview, false);
    assert.equal(docxPayload.previewUrl, null);
    assert.match(docxPayload.message, /not previewable/i);
  });
});

test('version confirmation verifies the database-stored S3 key and stores the actual size', async () => {
  let verifiedKey;
  await withS3Response(async (command) => {
    verifiedKey = command.input.Key;
    return { ContentLength: 128 };
  }, async () => {
    await withServer(async (port) => {
      const { token } = await registerUser(port, 'Alice', 'version-success@example.com');
      const file = await createFile(port, token, 'main.txt', 'text/plain');
      const versionData = await createVersion(port, token, file.file.id);
      const storedVersion = global.__kgkVersions[0];
      assert.equal(storedVersion.s3Key, versionData.objectKey);

      const response = await requestVersion(
        port,
        token,
        file.file.id,
        versionData.version.id,
        'confirm',
        { size: 128 },
      );

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(verifiedKey, storedVersion.s3Key);
      assert.equal(payload.version.status, 'uploaded');
      assert.equal(payload.version.size, 128);
    });
  });
});

test('version confirmation rejects a missing S3 object and leaves the version pending', async () => {
  await withS3Response(async () => {
    const error = new Error('not found');
    error.name = 'NoSuchKey';
    error.$metadata = { httpStatusCode: 404 };
    throw error;
  }, async () => {
    await withServer(async (port) => {
      const { token } = await registerUser(port, 'Alice', 'version-missing@example.com');
      const file = await createFile(port, token, 'main.txt', 'text/plain');
      const versionData = await createVersion(port, token, file.file.id);

      const response = await requestVersion(
        port,
        token,
        file.file.id,
        versionData.version.id,
        'confirm',
        { size: 128 },
      );

      assert.equal(response.status, 404);
      assert.equal(global.__kgkVersions[0].status, 'pending');
    });
  });
});

test('version confirmation rejects a size mismatch and leaves the version pending', async () => {
  await withS3Response(async () => ({ ContentLength: 127 }), async () => {
    await withServer(async (port) => {
      const { token } = await registerUser(port, 'Alice', 'version-size@example.com');
      const file = await createFile(port, token, 'main.txt', 'text/plain');
      const versionData = await createVersion(port, token, file.file.id);

      const response = await requestVersion(
        port,
        token,
        file.file.id,
        versionData.version.id,
        'confirm',
        { size: 128 },
      );

      assert.equal(response.status, 400);
      assert.equal(global.__kgkVersions[0].status, 'pending');
    });
  });
});

test('a user cannot confirm another user version', async () => {
  let headObjectCallCount = 0;
  await withS3Response(async () => {
    headObjectCallCount += 1;
    return { ContentLength: 128 };
  }, async () => {
    await withServer(async (port) => {
      const owner = await registerUser(port, 'Alice', 'version-owner@example.com');
      const otherUser = await registerUser(port, 'Bob', 'version-other@example.com');
      const file = await createFile(port, owner.token, 'main.txt', 'text/plain');
      const versionData = await createVersion(port, owner.token, file.file.id);

      const response = await requestVersion(
        port,
        otherUser.token,
        file.file.id,
        versionData.version.id,
        'confirm',
        { size: 128 },
      );

      assert.equal(response.status, 404);
      assert.equal(headObjectCallCount, 0);
      assert.equal(global.__kgkVersions[0].status, 'pending');
    });
  });
});

test('pending versions cannot be restored', async () => {
  let headObjectCallCount = 0;
  await withS3Response(async () => {
    headObjectCallCount += 1;
    return { ContentLength: 128 };
  }, async () => {
    await withServer(async (port) => {
      const { token } = await registerUser(port, 'Alice', 'restore-pending@example.com');
      const file = await createFile(port, token, 'main.txt', 'text/plain');
      const versionData = await createVersion(port, token, file.file.id);
      const fileBefore = JSON.stringify(global.__kgkFiles[0]);

      const response = await requestVersion(
        port,
        token,
        file.file.id,
        versionData.version.id,
        'restore',
      );

      assert.equal(response.status, 409);
      assert.equal(headObjectCallCount, 0);
      assert.equal(JSON.stringify(global.__kgkFiles[0]), fileBefore);
    });
  });
});

test('versions with missing S3 objects cannot be restored or change file metadata', async () => {
  await withS3Response(async () => {
    const error = new Error('not found');
    error.name = 'NoSuchKey';
    error.$metadata = { httpStatusCode: 404 };
    throw error;
  }, async () => {
    await withServer(async (port) => {
      const { token } = await registerUser(port, 'Alice', 'restore-missing@example.com');
      const file = await createFile(port, token, 'main.txt', 'text/plain');
      const versionData = await createVersion(port, token, file.file.id);
      global.__kgkVersions[0].status = 'uploaded';
      global.__kgkVersions[0].size = 128;
      const fileBefore = JSON.stringify(global.__kgkFiles[0]);

      const response = await requestVersion(
        port,
        token,
        file.file.id,
        versionData.version.id,
        'restore',
      );

      assert.equal(response.status, 404);
      assert.equal(JSON.stringify(global.__kgkFiles[0]), fileBefore);
    });
  });
});

test('successful restoration switches metadata to the verified existing S3 key', async () => {
  let verifiedKey;
  await withS3Response(async (command) => {
    verifiedKey = command.input.Key;
    return { ContentLength: 128 };
  }, async () => {
    await withServer(async (port) => {
      const { token } = await registerUser(port, 'Alice', 'restore-success@example.com');
      const file = await createFile(port, token, 'main.txt', 'text/plain');
      const versionData = await createVersion(port, token, file.file.id, 'restored.txt');
      const storedVersion = global.__kgkVersions[0];
      storedVersion.status = 'uploaded';
      storedVersion.size = 128;

      const response = await requestVersion(
        port,
        token,
        file.file.id,
        versionData.version.id,
        'restore',
      );

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(verifiedKey, storedVersion.s3Key);
      assert.equal(payload.file.s3Key, storedVersion.s3Key);
      assert.equal(payload.file.originalName, storedVersion.originalName);
      assert.equal(payload.file.status, 'restored');
    });
  });
});
