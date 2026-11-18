const test = require('node:test');
const assert = require('node:assert/strict');

const originalAwsBucket = process.env.AWS_S3_BUCKET;

process.env.AWS_S3_BUCKET = '';

const { createApp } = require('../src/app');

if (originalAwsBucket === undefined) {
  delete process.env.AWS_S3_BUCKET;
} else {
  process.env.AWS_S3_BUCKET = originalAwsBucket;
}

const authHeaders = (token, includeJson = true) => ({
  ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
  Authorization: 'Bearer ' + token,
});

const resetStorage = () => {
  global.__kgkUsers.length = 0;
  global.__kgkFiles.length = 0;
  global.__kgkFolders.length = 0;
  global.__kgkShares.length = 0;
  global.__kgkVersions.length = 0;
};

const registerUser = async (app, port, user) => {
  const response = await fetch('http://127.0.0.1:' + port + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });

  assert.equal(response.status, 201);
  return response.json();
};

test('upload URL endpoint creates a file record for the authenticated user', async () => {
  resetStorage();

  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const newUser = await registerUser(app, port, {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'StrongPass123!',
    });

    const uploadResponse = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(newUser.token),
      body: JSON.stringify({
        fileName: 'notes.txt',
        mimeType: 'text/plain',
      }),
    });

    assert.equal(uploadResponse.status, 200);
    const uploadPayload = await uploadResponse.json();
    assert.equal(uploadPayload.file.userId, newUser.user.id);
    assert.ok(uploadPayload.uploadUrl);
    assert.equal(uploadPayload.mode, 'local-dev');

    const confirmResponse = await fetch('http://127.0.0.1:' + port + '/api/files/confirm-upload', {
      method: 'POST',
      headers: authHeaders(newUser.token),
      body: JSON.stringify({
        fileId: uploadPayload.file.id,
        size: 128,
      }),
    });

    assert.equal(confirmResponse.status, 200);
    const confirmPayload = await confirmResponse.json();
    assert.equal(confirmPayload.file.status, 'uploaded');
    assert.equal(confirmPayload.file.size, 128);

    const listResponse = await fetch('http://127.0.0.1:' + port + '/api/files', {
      headers: authHeaders(newUser.token, false),
    });

    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json();
    assert.equal(listPayload.files.length, 1);
    assert.equal(listPayload.files[0].status, 'uploaded');
  } finally {
    server.close();
  }
});

test('download URL endpoint blocks access to another users file', async () => {
  resetStorage();

  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const userOne = await registerUser(app, port, {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'StrongPass123!',
    });

    const userTwo = await registerUser(app, port, {
      name: 'Bob',
      email: 'bob@example.com',
      password: 'StrongPass123!',
    });

    const uploadResponse = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(userOne.token),
      body: JSON.stringify({
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
      }),
    });

    const uploadPayload = await uploadResponse.json();
    const forbiddenResponse = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id + '/download-url', {
      headers: authHeaders(userTwo.token, false),
    });

    assert.equal(forbiddenResponse.status, 403);
    const payload = await forbiddenResponse.json();
    assert.match(payload.message, /permission/i);
  } finally {
    server.close();
  }
});

test('delete file endpoint removes only the authenticated users file', async () => {
  resetStorage();

  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const userOne = await registerUser(app, port, {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'StrongPass123!',
    });

    const userTwo = await registerUser(app, port, {
      name: 'Bob',
      email: 'bob@example.com',
      password: 'StrongPass123!',
    });

    const uploadResponse = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(userOne.token),
      body: JSON.stringify({
        fileName: 'archive.zip',
        mimeType: 'application/zip',
      }),
    });

    const uploadPayload = await uploadResponse.json();
    const deleteResponse = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id, {
      method: 'DELETE',
      headers: authHeaders(userTwo.token, false),
    });

    assert.equal(deleteResponse.status, 403);

    const successfulDelete = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id, {
      method: 'DELETE',
      headers: authHeaders(userOne.token, false),
    });

    assert.equal(successfulDelete.status, 200);
    const deletePayload = await successfulDelete.json();
    assert.equal(deletePayload.fileId, uploadPayload.file.id);
  } finally {
    server.close();
  }
});

test('update file endpoint renames and moves a file into a folder', async () => {
  resetStorage();

  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const user = await registerUser(app, port, {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'StrongPass123!',
    });

    const folderResponse = await fetch('http://127.0.0.1:' + port + '/api/folders', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ name: 'Documents' }),
    });

    const folderPayload = await folderResponse.json();

    const uploadResponse = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'draft.txt', mimeType: 'text/plain' }),
    });

    const uploadPayload = await uploadResponse.json();
    await fetch('http://127.0.0.1:' + port + '/api/files/confirm-upload', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileId: uploadPayload.file.id, size: 42 }),
    });

    const updateResponse = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id, {
      method: 'PUT',
      headers: authHeaders(user.token),
      body: JSON.stringify({
        originalName: 'final-draft.txt',
        folderId: folderPayload.folder.id,
      }),
    });

    assert.equal(updateResponse.status, 200);
    const updatePayload = await updateResponse.json();
    assert.equal(updatePayload.file.originalName, 'final-draft.txt');
    assert.equal(updatePayload.file.folderId, folderPayload.folder.id);
  } finally {
    server.close();
  }
});

test('list files supports search, type filter, and sorting', async () => {
  resetStorage();

  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const user = await registerUser(app, port, {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'StrongPass123!',
    });

    const fileOne = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'alpha-report.pdf', mimeType: 'application/pdf' }),
    });

    const fileTwo = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'beta-photo.png', mimeType: 'image/png' }),
    });

    const fileThree = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'gamma-notes.txt', mimeType: 'text/plain' }),
    });

    const onePayload = await fileOne.json();
    const twoPayload = await fileTwo.json();
    const threePayload = await fileThree.json();

    await Promise.all([
      fetch('http://127.0.0.1:' + port + '/api/files/confirm-upload', {
        method: 'POST',
        headers: authHeaders(user.token),
        body: JSON.stringify({ fileId: onePayload.file.id, size: 100 }),
      }),
      fetch('http://127.0.0.1:' + port + '/api/files/confirm-upload', {
        method: 'POST',
        headers: authHeaders(user.token),
        body: JSON.stringify({ fileId: twoPayload.file.id, size: 70 }),
      }),
      fetch('http://127.0.0.1:' + port + '/api/files/confirm-upload', {
        method: 'POST',
        headers: authHeaders(user.token),
        body: JSON.stringify({ fileId: threePayload.file.id, size: 40 }),
      }),
    ]);

    const searchResponse = await fetch('http://127.0.0.1:' + port + '/api/files?search=report&type=document&sortBy=name&order=asc', {
      headers: authHeaders(user.token, false),
    });

    assert.equal(searchResponse.status, 200);
    const searchPayload = await searchResponse.json();
    assert.equal(searchPayload.total, 1);
    assert.equal(searchPayload.files[0].originalName, 'alpha-report.pdf');

    const sortResponse = await fetch('http://127.0.0.1:' + port + '/api/files?sortBy=size&order=desc', {
      headers: authHeaders(user.token, false),
    });

    assert.equal(sortResponse.status, 200);
    const sortPayload = await sortResponse.json();
    assert.equal(sortPayload.files[0].originalName, 'alpha-report.pdf');
    assert.equal(sortPayload.files[1].originalName, 'beta-photo.png');
    assert.equal(sortPayload.files[2].originalName, 'gamma-notes.txt');
  } finally {
    server.close();
  }
});

test('preview endpoint returns a URL for previewable files', async () => {
  resetStorage();

  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const user = await registerUser(app, port, {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'StrongPass123!',
    });

    const uploadResponse = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'annual-report.pdf', mimeType: 'application/pdf' }),
    });

    const uploadPayload = await uploadResponse.json();

    await fetch('http://127.0.0.1:' + port + '/api/files/confirm-upload', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileId: uploadPayload.file.id, size: 3456 }),
    });

    const previewResponse = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id + '/preview', {
      headers: authHeaders(user.token, false),
    });

    assert.equal(previewResponse.status, 200);
    const previewPayload = await previewResponse.json();
    assert.equal(previewPayload.canPreview, true);
    assert.match(previewPayload.previewUrl, /annual-report|local-dev/i);
  } finally {
    server.close();
  }
});

test('share endpoint creates a public download link for a users file', async () => {
  resetStorage();

  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const user = await registerUser(app, port, {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'StrongPass123!',
    });

    const uploadResponse = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'shared-doc.pdf', mimeType: 'application/pdf' }),
    });

    const uploadPayload = await uploadResponse.json();

    await fetch('http://127.0.0.1:' + port + '/api/files/confirm-upload', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileId: uploadPayload.file.id, size: 6543 }),
    });

    const shareResponse = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id + '/share', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ expiresInMinutes: 30 }),
    });

    assert.equal(shareResponse.status, 200);
    const sharePayload = await shareResponse.json();
    assert.ok(sharePayload.share.shareUrl.includes('/api/files/shared/'));

    const publicResponse = await fetch(sharePayload.share.shareUrl);
    assert.equal(publicResponse.status, 200);
    const publicPayload = await publicResponse.json();
    assert.equal(publicPayload.file.originalName, 'shared-doc.pdf');
    assert.ok(publicPayload.downloadUrl);
  } finally {
    server.close();
  }
});

test('version endpoints create, list, and restore file versions', async () => {
  resetStorage();

  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const user = await registerUser(app, port, {
      name: 'Alice',
      email: 'alice@example.com',
      password: 'StrongPass123!',
    });

    const uploadResponse = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'main.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    });

    const uploadPayload = await uploadResponse.json();
    await fetch('http://127.0.0.1:' + port + '/api/files/confirm-upload', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileId: uploadPayload.file.id, size: 100 }),
    });

    const versionResponse = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id + '/versions', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'main-v2.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    });

    assert.equal(versionResponse.status, 200);
    const versionPayload = await versionResponse.json();
    assert.equal(versionPayload.version.versionNumber, 1);

    const confirmVersionResponse = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id + '/versions/' + versionPayload.version.id + '/confirm', {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ size: 250 }),
    });

    assert.equal(confirmVersionResponse.status, 200);
    const confirmVersionPayload = await confirmVersionResponse.json();
    assert.equal(confirmVersionPayload.version.status, 'uploaded');

    const listVersionsResponse = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id + '/versions', {
      headers: authHeaders(user.token, false),
    });

    assert.equal(listVersionsResponse.status, 200);
    const listVersionsPayload = await listVersionsResponse.json();
    assert.equal(listVersionsPayload.versions.length, 1);

    const restoreResponse = await fetch('http://127.0.0.1:' + port + '/api/files/' + uploadPayload.file.id + '/versions/' + versionPayload.version.id + '/restore', {
      method: 'POST',
      headers: authHeaders(user.token, false),
    });

    assert.equal(restoreResponse.status, 200);
    const restorePayload = await restoreResponse.json();
    assert.equal(restorePayload.file.originalName, 'main-v2.docx');
  } finally {
    server.close();
  }
});
