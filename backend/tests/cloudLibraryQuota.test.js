const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.AWS_S3_BUCKET = '';
process.env.MAX_USER_STORAGE_BYTES = '100';
process.env.MAX_USER_FILES = '10';

const { createApp } = require('../src/app');

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

const authHeaders = (token) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

const registerUser = async (port) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Quota User', email: `quota-${Date.now()}-${Math.random()}@example.com`, password: 'StrongPass123!' }),
  });
  assert.equal(response.status, 201);
  return response.json();
};

const createReservation = (port, token, fileName, size = 1) => fetch(
  `http://127.0.0.1:${port}/api/files/upload-url`,
  {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileName, mimeType: 'text/plain', size }),
  },
);

const confirmReservation = (port, token, fileId, size) => fetch(
  `http://127.0.0.1:${port}/api/files/confirm-upload`,
  {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileId, size }),
  },
);

test('storage quota reserves requested bytes before upload confirmation', async () => {
  await withServer(async (port) => {
    const { token } = await registerUser(port);
    const first = await createReservation(port, token, 'first.txt', 60);
    assert.equal(first.status, 200);
    const second = await createReservation(port, token, 'second.txt', 50);
    assert.equal(second.status, 413);

    const quotaResponse = await fetch(`http://127.0.0.1:${port}/api/files/quota`, {
      headers: authHeaders(token),
    });
    const quota = await quotaResponse.json();
    assert.equal(quota.usedStorageBytes, 60);
    assert.equal(quota.fileCount, 1);
  });
});

test('concurrent reservations cannot exceed the per-user file limit', async () => {
  await withServer(async (port) => {
    const { token } = await registerUser(port);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) => createReservation(port, token, `file-${index}.txt`, 1)),
    );
    const successes = results.filter((response) => response.status === 200);
    const rejected = results.filter((response) => response.status === 403);
    assert.equal(successes.length, 10);
    assert.equal(rejected.length, 2);
    assert.equal(global.__kgkFiles.length, 10);
  });
});

test('Recent, Starred, Trash, Restore and Permanent Delete endpoints work together', async () => {
  await withServer(async (port) => {
    const { token } = await registerUser(port);
    const uploadResponse = await createReservation(port, token, 'library.txt', 12);
    const upload = await uploadResponse.json();
    const confirmResponse = await confirmReservation(port, token, upload.file.id, 12);
    assert.equal(confirmResponse.status, 200);

    const starResponse = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}/star`, {
      method: 'PATCH',
      headers: authHeaders(token),
    });
    assert.equal(starResponse.status, 200);

    const recentResponse = await fetch(`http://127.0.0.1:${port}/api/files/recent`, {
      headers: authHeaders(token),
    });
    assert.equal((await recentResponse.json()).total, 1);

    const starredResponse = await fetch(`http://127.0.0.1:${port}/api/files/starred`, {
      headers: authHeaders(token),
    });
    assert.equal((await starredResponse.json()).total, 1);

    const trashResponse = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    assert.equal(trashResponse.status, 200);

    const listTrash = await fetch(`http://127.0.0.1:${port}/api/files/trash`, {
      headers: authHeaders(token),
    });
    assert.equal((await listTrash.json()).total, 1);

    const restoreResponse = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}/restore`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    assert.equal(restoreResponse.status, 200);

    const trashAgain = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    assert.equal(trashAgain.status, 200);

    const permanentDelete = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}/permanent`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    assert.equal(permanentDelete.status, 200);
    assert.equal(global.__kgkFiles.length, 0);
  });
});

test('Trash continues to count toward quota and version reservations consume storage', async () => {
  await withServer(async (port) => {
    const { token } = await registerUser(port);
    const uploadResponse = await createReservation(port, token, 'quota-file.txt', 60);
    const upload = await uploadResponse.json();
    const confirmResponse = await confirmReservation(port, token, upload.file.id, 60);
    assert.equal(confirmResponse.status, 200);

    const trashResponse = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    });
    assert.equal(trashResponse.status, 200);

    const quotaAfterTrashResponse = await fetch(`http://127.0.0.1:${port}/api/files/quota`, {
      headers: authHeaders(token),
    });
    const quotaAfterTrash = await quotaAfterTrashResponse.json();
    assert.equal(quotaAfterTrash.fileCount, 1);
    assert.equal(quotaAfterTrash.usedStorageBytes, 60);

    const versionResponse = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}/versions`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ fileName: 'large-version.txt', mimeType: 'text/plain', size: 40 }),
    });
    assert.equal(versionResponse.status, 404); // The parent is in Trash and cannot receive a new version.

    const restoreResponse = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}/restore`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    assert.equal(restoreResponse.status, 200);

    const acceptedVersion = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}/versions`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ fileName: 'large-version.txt', mimeType: 'text/plain', size: 40 }),
    });
    assert.equal(acceptedVersion.status, 200);
    const versionPayload = await acceptedVersion.json();

    const rejectedVersion = await fetch(`http://127.0.0.1:${port}/api/files/${upload.file.id}/versions`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ fileName: 'over-limit.txt', mimeType: 'text/plain', size: 1 }),
    });
    assert.equal(rejectedVersion.status, 413);

    const cancelled = await fetch(
      `http://127.0.0.1:${port}/api/files/${upload.file.id}/versions/${versionPayload.version.id}/cancel`,
      { method: 'DELETE', headers: authHeaders(token) },
    );
    assert.equal(cancelled.status, 200);

    const finalQuotaResponse = await fetch(`http://127.0.0.1:${port}/api/files/quota`, {
      headers: authHeaders(token),
    });
    const finalQuota = await finalQuotaResponse.json();
    assert.equal(finalQuota.fileCount, 1);
    assert.equal(finalQuota.usedStorageBytes, 60);
  });
});
