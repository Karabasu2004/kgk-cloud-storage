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
const { s3Client } = require('../src/config/aws');

let s3SendMock = null;
const originalS3Send = s3Client.send;

s3Client.send = async (command) => {
  if (s3SendMock) {
    return s3SendMock(command);
  }
  if (command.constructor.name === 'HeadObjectCommand') {
    const file = global.__kgkFiles.find((f) => f.s3Key === command.input.Key);
    if (file) {
      return { ContentLength: file.reservedSize || file.size || 100 };
    }
    const version = global.__kgkVersions.find((v) => v.s3Key === command.input.Key);
    if (version) {
      return { ContentLength: version.reservedSize || version.size || 100 };
    }
    return { ContentLength: 100 };
  }
  if (command instanceof DeleteObjectCommand) {
    return {};
  }
  return {};
};

const withS3Send = async (send, callback) => {
  const previous = s3SendMock;
  s3SendMock = send;
  try {
    await callback();
  } finally {
    s3SendMock = previous;
  }
};

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

const registerUser = async (port, email = 'user@example.com', name = 'Test User') => {
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'StrongPass123!' }),
  });
  assert.equal(response.status, 201);
  return response.json();
};

const createAndConfirmFile = async (port, token, fileName = 'file.txt', size = 100, mimeType = 'text/plain') => {
  const uploadRes = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileName, mimeType, size }),
  });
  assert.equal(uploadRes.status, 200);
  const uploadData = await uploadRes.json();

  const confirmRes = await fetch(`http://127.0.0.1:${port}/api/files/confirm-upload`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ fileId: uploadData.file.id, size }),
  });
  assert.equal(confirmRes.status, 200);
  const confirmData = await confirmRes.json();

  return confirmData.file;
};

// 1. Recent Files Tests
test('recent files returns correct user files sorted by updatedAt/createdAt and excludes Trash', async () => {
  await withServer(async (port) => {
    const user1 = await registerUser(port, 'recent1@example.com', 'User 1');
    const user2 = await registerUser(port, 'recent2@example.com', 'User 2');

    const file1 = await createAndConfirmFile(port, user1.token, 'file1.txt', 10);
    const file2 = await createAndConfirmFile(port, user1.token, 'file2.txt', 20);
    await createAndConfirmFile(port, user2.token, 'user2-file.txt', 30);

    // Update file1 originalName to make its updatedAt newer than file2
    await new Promise((r) => setTimeout(r, 10));
    await fetch(`http://127.0.0.1:${port}/api/files/${file1.id}`, {
      method: 'PUT',
      headers: authHeaders(user1.token),
      body: JSON.stringify({ originalName: 'file1-renamed.txt' }),
    });

    const recentRes = await fetch(`http://127.0.0.1:${port}/api/files/recent`, {
      headers: authHeaders(user1.token, false),
    });
    assert.equal(recentRes.status, 200);
    const recentData = await recentRes.json();
    assert.equal(recentData.files.length, 2);
    // file1 was updated, so it should be first
    assert.equal(recentData.files[0].id, file1.id);
    assert.equal(recentData.files[1].id, file2.id);

    // Now soft delete file1 into Trash
    const delRes = await fetch(`http://127.0.0.1:${port}/api/files/${file1.id}`, {
      method: 'DELETE',
      headers: authHeaders(user1.token, false),
    });
    assert.equal(delRes.status, 200);

    // Recent files should now exclude file1
    const recentAfterTrash = await fetch(`http://127.0.0.1:${port}/api/files/recent`, {
      headers: authHeaders(user1.token, false),
    });
    const recentAfterTrashData = await recentAfterTrash.json();
    assert.equal(recentAfterTrashData.files.length, 1);
    assert.equal(recentAfterTrashData.files[0].id, file2.id);
  });
});

// 2. Starred Files Tests
test('starred files: star, unstar, list, ownership verification, and trash prohibition', async () => {
  await withServer(async (port) => {
    const owner = await registerUser(port, 'star-owner@example.com', 'Owner');
    const stranger = await registerUser(port, 'star-stranger@example.com', 'Stranger');

    const file = await createAndConfirmFile(port, owner.token, 'document.pdf', 50, 'application/pdf');

    // Stranger cannot star owner's file
    const strangerStar = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/star`, {
      method: 'PATCH',
      headers: authHeaders(stranger.token, false),
    });
    assert.equal(strangerStar.status, 403);

    // Owner stars file
    const starRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/star`, {
      method: 'PATCH',
      headers: authHeaders(owner.token, false),
    });
    assert.equal(starRes.status, 200);
    const starData = await starRes.json();
    assert.equal(starData.file.isStarred, true);

    // List starred
    const listRes = await fetch(`http://127.0.0.1:${port}/api/files/starred`, {
      headers: authHeaders(owner.token, false),
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.files.length, 1);
    assert.equal(listData.files[0].id, file.id);

    // Unstar file
    const unstarRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/star`, {
      method: 'PATCH',
      headers: authHeaders(owner.token, false),
    });
    assert.equal(unstarRes.status, 200);
    const unstarData = await unstarRes.json();
    assert.equal(unstarData.file.isStarred, false);

    // Move file to trash
    await fetch(`http://127.0.0.1:${port}/api/files/${file.id}`, {
      method: 'DELETE',
      headers: authHeaders(owner.token, false),
    });

    // Cannot star a file in Trash
    const trashStarRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/star`, {
      method: 'PATCH',
      headers: authHeaders(owner.token, false),
    });
    assert.equal(trashStarRes.status, 400);
  });
});

// 3. Trash and Restore Tests
test('trash and restore: soft-delete, listing, restore, and permanent deletion only from trash', async () => {
  await withServer(async (port) => {
    const user = await registerUser(port, 'trash@example.com', 'Trash User');
    const file = await createAndConfirmFile(port, user.token, 'archive.zip', 500, 'application/zip');

    // Trying permanent delete while active must fail
    const prematurePermanent = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/permanent`, {
      method: 'DELETE',
      headers: authHeaders(user.token, false),
    });
    assert.equal(prematurePermanent.status, 400);

    // Normal delete -> Soft delete
    const deleteRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}`, {
      method: 'DELETE',
      headers: authHeaders(user.token, false),
    });
    assert.equal(deleteRes.status, 200);
    const deleteData = await deleteRes.json();
    assert.equal(deleteData.file.isDeleted, true);
    assert.ok(deleteData.file.deletedAt);

    // Normal list excludes trashed file
    const listRes = await fetch(`http://127.0.0.1:${port}/api/files`, {
      headers: authHeaders(user.token, false),
    });
    const listData = await listRes.json();
    assert.equal(listData.files.length, 0);

    // Trash list includes file
    const trashRes = await fetch(`http://127.0.0.1:${port}/api/files/trash`, {
      headers: authHeaders(user.token, false),
    });
    assert.equal(trashRes.status, 200);
    const trashData = await trashRes.json();
    assert.equal(trashData.files.length, 1);
    assert.equal(trashData.files[0].id, file.id);

    // Restore file
    const restoreRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/restore`, {
      method: 'POST',
      headers: authHeaders(user.token, false),
    });
    assert.equal(restoreRes.status, 200);
    const restoreData = await restoreRes.json();
    assert.equal(restoreData.file.isDeleted, false);
    assert.equal(restoreData.file.deletedAt, null);

    // Normal list shows file again
    const listAfterRestore = await fetch(`http://127.0.0.1:${port}/api/files`, {
      headers: authHeaders(user.token, false),
    });
    const listAfterRestoreData = await listAfterRestore.json();
    assert.equal(listAfterRestoreData.files.length, 1);

    // Soft delete again and then permanently delete
    await fetch(`http://127.0.0.1:${port}/api/files/${file.id}`, {
      method: 'DELETE',
      headers: authHeaders(user.token, false),
    });

    const permRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/permanent`, {
      method: 'DELETE',
      headers: authHeaders(user.token, false),
    });
    assert.equal(permRes.status, 200);

    // File completely removed
    assert.equal(global.__kgkFiles.length, 0);
  });
});

// 4. Download, preview, rename, and sharing rejected on trashed files
test('trashed files reject download, preview, rename, version creation, and public share access', async () => {
  await withServer(async (port) => {
    const user = await registerUser(port, 'guard@example.com', 'Guard User');
    const file = await createAndConfirmFile(port, user.token, 'doc.pdf', 100, 'application/pdf');

    // Create a share link before trashing
    const shareRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/share`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ expiresInMinutes: 60 }),
    });
    assert.equal(shareRes.status, 200);
    const shareData = await shareRes.json();

    // Soft delete file
    await fetch(`http://127.0.0.1:${port}/api/files/${file.id}`, {
      method: 'DELETE',
      headers: authHeaders(user.token, false),
    });

    // Download URL denied
    const dlRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/download-url`, {
      headers: authHeaders(user.token, false),
    });
    assert.equal(dlRes.status, 404);

    // Preview denied
    const prevRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/preview`, {
      headers: authHeaders(user.token, false),
    });
    assert.equal(prevRes.status, 404);

    // Rename/update denied
    const updateRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}`, {
      method: 'PUT',
      headers: authHeaders(user.token),
      body: JSON.stringify({ originalName: 'new-name.pdf' }),
    });
    assert.equal(updateRes.status, 404);

    // Version creation denied
    const verRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/versions`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'v2.pdf', mimeType: 'application/pdf', size: 100 }),
    });
    assert.equal(verRes.status, 404);

    // Public share link access denied
    const shareAccessRes = await fetch(shareData.share.shareUrl);
    assert.equal(shareAccessRes.status, 404);
  });
});

// 5. 10-File limit enforcement (including pending and trashed files)
test('file limit: max 10 files enforced across active, pending, and trashed files', async () => {
  await withServer(async (port) => {
    const user = await registerUser(port, 'quota-files@example.com', 'Quota User');

    // Create 8 confirmed files
    for (let i = 1; i <= 8; i += 1) {
      await createAndConfirmFile(port, user.token, `file-${i}.txt`, 10);
    }

    // Move file-1 to trash (still counts toward 10 file limit)
    const file1 = global.__kgkFiles[0];
    await fetch(`http://127.0.0.1:${port}/api/files/${file1.id}`, {
      method: 'DELETE',
      headers: authHeaders(user.token, false),
    });

    // Create 9th file (confirmed)
    await createAndConfirmFile(port, user.token, 'file-9.txt', 10);

    // Create 10th file as pending (reserves 10th slot)
    const upload10 = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'file-10.txt', mimeType: 'text/plain', size: 10 }),
    });
    assert.equal(upload10.status, 200);

    // 11th file must be rejected because 10 files are accounted for
    const upload11 = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'file-11.txt', mimeType: 'text/plain', size: 10 }),
    });
    assert.equal(upload11.status, 403);
    const payload11 = await upload11.json();
    assert.match(payload11.message, /limit/i);
  });
});

// 6. 100 MiB Storage limit, file versions, and duplicate S3 key accounting
test('storage limit: enforces 100 MiB quota, counts versions, and deduplicates identical S3 keys', async () => {
  process.env.MAX_USER_STORAGE_BYTES = '1000'; // Set small limit for testing: 1000 bytes

  await withServer(async (port) => {
    const user = await registerUser(port, 'storage-limit@example.com', 'Storage User');

    // Upload a 600 byte file
    const file = await createAndConfirmFile(port, user.token, 'big.bin', 600);

    // Creating version of 500 bytes should fail (600 + 500 > 1000)
    const versionFail = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/versions`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'big-v2.bin', mimeType: 'application/octet-stream', size: 500 }),
    });
    assert.equal(versionFail.status, 413);

    // Creating version of 300 bytes succeeds (600 + 300 <= 1000)
    const versionRes = await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/versions`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'big-v2.bin', mimeType: 'application/octet-stream', size: 300 }),
    });
    assert.equal(versionRes.status, 200);
    const versionData = await versionRes.json();

    // Confirm version
    await fetch(`http://127.0.0.1:${port}/api/files/${file.id}/versions/${versionData.version.id}/confirm`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ size: 300 }),
    });

    // Check quota info endpoint
    const quotaRes = await fetch(`http://127.0.0.1:${port}/api/files/quota`, {
      headers: authHeaders(user.token, false),
    });
    assert.equal(quotaRes.status, 200);
    const quotaData = await quotaRes.json();
    assert.equal(quotaData.usedStorageBytes, 900); // 600 + 300

    // Duplicate S3 key test: simulate restoring version where file.s3Key becomes version.s3Key
    global.__kgkFiles[0].s3Key = global.__kgkVersions[0].s3Key; // duplicate s3Key!
    const quotaDedupeRes = await fetch(`http://127.0.0.1:${port}/api/files/quota`, {
      headers: authHeaders(user.token, false),
    });
    const quotaDedupeData = await quotaDedupeRes.json();
    // Since both file and version have the exact same S3 key, it should only be counted once!
    assert.equal(quotaDedupeData.usedStorageBytes, 600);
  });

  delete process.env.MAX_USER_STORAGE_BYTES;
});

// 7. Expired pending upload reservations do not block quota
test('pending uploads expire after TTL and no longer consume quota reservations', async () => {
  process.env.MAX_USER_STORAGE_BYTES = '500';

  await withServer(async (port) => {
    const user = await registerUser(port, 'expired-pending@example.com', 'TTL User');

    // Create pending upload reserving 400 bytes
    await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'pending.bin', mimeType: 'application/octet-stream', size: 400 }),
    });

    // At this moment, another 200 byte upload would exceed 500 bytes
    const failUpload = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'overflow.bin', mimeType: 'application/octet-stream', size: 200 }),
    });
    assert.equal(failUpload.status, 413);

    // Simulate expiration of the pending upload (older than 1 hour)
    global.__kgkFiles[0].createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    // Now, the expired pending upload is ignored, allowing the 200 byte upload
    const okUpload = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'overflow.bin', mimeType: 'application/octet-stream', size: 200 }),
    });
    assert.equal(okUpload.status, 200);
  });

  delete process.env.MAX_USER_STORAGE_BYTES;
});

// 8. Upload confirmation rejects and cleans up object that exceeds quota
test('confirmUpload rejects and deletes object from S3 if actual size exceeds remaining quota', async () => {
  process.env.MAX_USER_STORAGE_BYTES = '500';

  await withServer(async (port) => {
    const user = await registerUser(port, 'actual-size@example.com', 'Actual Size User');

    // Declare size 300 bytes
    const uploadRes = await fetch(`http://127.0.0.1:${port}/api/files/upload-url`, {
      method: 'POST',
      headers: authHeaders(user.token),
      body: JSON.stringify({ fileName: 'file.bin', mimeType: 'application/octet-stream', size: 300 }),
    });
    const uploadData = await uploadRes.json();

    let deletedFromS3 = false;
    await withS3Send(async (command) => {
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ContentLength: 600 };
      }
      if (command instanceof DeleteObjectCommand) {
        deletedFromS3 = true;
        return {};
      }
      return {};
    }, async () => {
      // Confirm with actual size 600 bytes (which exceeds the 500 bytes limit!)
      const confirmRes = await fetch(`http://127.0.0.1:${port}/api/files/confirm-upload`, {
        method: 'POST',
        headers: authHeaders(user.token),
        body: JSON.stringify({ fileId: uploadData.file.id, size: 600 }),
      });
      assert.equal(confirmRes.status, 413);
      assert.equal(deletedFromS3, true);
    });
  });

  delete process.env.MAX_USER_STORAGE_BYTES;
});
