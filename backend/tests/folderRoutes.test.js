const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

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

test('folder endpoints allow authenticated users to create, rename, and delete folders', async () => {
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

    const createResponse = await fetch('http://127.0.0.1:' + port + '/api/folders', {
      method: 'POST',
      headers: authHeaders(newUser.token),
      body: JSON.stringify({ name: 'Projects' }),
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.folder.name, 'Projects');

    const renameResponse = await fetch('http://127.0.0.1:' + port + '/api/folders/' + created.folder.id, {
      method: 'PUT',
      headers: authHeaders(newUser.token),
      body: JSON.stringify({ name: 'Work Files' }),
    });

    assert.equal(renameResponse.status, 200);
    const renamed = await renameResponse.json();
    assert.equal(renamed.folder.name, 'Work Files');

    const listResponse = await fetch('http://127.0.0.1:' + port + '/api/folders', {
      headers: authHeaders(newUser.token, false),
    });

    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json();
    assert.equal(listPayload.folders.length, 1);
    assert.equal(listPayload.folders[0].name, 'Work Files');

    const deleteResponse = await fetch('http://127.0.0.1:' + port + '/api/folders/' + created.folder.id, {
      method: 'DELETE',
      headers: authHeaders(newUser.token, false),
    });

    assert.equal(deleteResponse.status, 200);
    const deletePayload = await deleteResponse.json();
    assert.equal(deletePayload.folderId, created.folder.id);
  } finally {
    server.close();
  }
});

test('upload accepts a user-owned folder id and stores the folder association', async () => {
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

    const folderResponse = await fetch('http://127.0.0.1:' + port + '/api/folders', {
      method: 'POST',
      headers: authHeaders(newUser.token),
      body: JSON.stringify({ name: 'Marketing' }),
    });

    const folderPayload = await folderResponse.json();

    const uploadResponse = await fetch('http://127.0.0.1:' + port + '/api/files/upload-url', {
      method: 'POST',
      headers: authHeaders(newUser.token),
      body: JSON.stringify({
        fileName: 'campaign-outline.pdf',
        mimeType: 'application/pdf',
        folderId: folderPayload.folder.id,
      }),
    });

    assert.equal(uploadResponse.status, 200);
    const uploadPayload = await uploadResponse.json();
    assert.equal(uploadPayload.file.folderId, folderPayload.folder.id);
  } finally {
    server.close();
  }
});
