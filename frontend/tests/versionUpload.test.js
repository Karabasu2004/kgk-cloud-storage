import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VITE_API_BASE_URL = 'http://localhost:5000/api';
const { generateUploadUrl, uploadVersion, MAX_UPLOAD_SIZE_BYTES } = await import('../src/services/api.js');

const withFetch = async (fetchMock, callback) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const jsonResponse = (payload, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => payload,
});

test('version bytes are PUT before confirmation with matching signed headers', async () => {
  const calls = [];
  const file = { name: 'revision.pdf', type: 'application/pdf', size: 256 };

  await withFetch(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      assert.equal(JSON.parse(options.body).size, file.size);
      return jsonResponse({
        uploadUrl: 'https://storage.example/upload',
        version: { id: 'version-1' },
      });
    }
    if (calls.length === 2) {
      return jsonResponse({});
    }
    return jsonResponse({ version: { id: 'version-1', status: 'uploaded' } });
  }, async () => {
    const result = await uploadVersion('test-token', 'file-1', file);

    assert.equal(result.version.status, 'uploaded');
    assert.equal(calls.length, 3);
    assert.match(calls[0].url, /\/versions$/);
    assert.equal(calls[1].url, 'https://storage.example/upload');
    assert.equal(calls[1].options.method, 'PUT');
    assert.equal(calls[1].options.body, file);
    assert.equal(calls[1].options.headers['Content-Type'], file.type);
    assert.equal(calls[1].options.headers['Cache-Control'], 'no-cache');
    assert.equal(calls[1].options.headers.Authorization, undefined);
    assert.match(calls[2].url, /\/versions\/version-1\/confirm$/);
  });
});

test('a failed version PUT does not call confirmation', async () => {
  const calls = [];
  const file = { name: 'revision.pdf', type: 'application/pdf', size: 256 };

  await withFetch(async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return jsonResponse({
        uploadUrl: 'https://storage.example/upload',
        version: { id: 'version-1' },
      });
    }
    return jsonResponse({}, false, 403);
  }, async () => {
    await assert.rejects(
      uploadVersion('test-token', 'file-1', file),
      /Storage upload failed \(HTTP 403\)/,
    );
    assert.equal(calls.length, 2);
    assert.doesNotMatch(calls[1], /\/confirm$/);
  });
});

test('an empty file MIME type uses the same fallback in the URL request and S3 PUT', async () => {
  const calls = [];
  const file = { name: 'unknown.bin', type: '', size: 12 };

  await withFetch(async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      assert.equal(JSON.parse(options.body).mimeType, 'application/octet-stream');
      assert.equal(JSON.parse(options.body).size, file.size);
      return jsonResponse({
        uploadUrl: 'https://storage.example/upload',
        version: { id: 'version-1' },
      });
    }
    if (calls.length === 2) {
      return jsonResponse({});
    }
    return jsonResponse({ version: { status: 'uploaded' } });
  }, async () => {
    await uploadVersion('test-token', 'file-1', file);
    assert.equal(calls[1].options.headers['Content-Type'], 'application/octet-stream');
  });
});

test('main file upload URL request includes the selected size', async () => {
  let requestOptions;
  await withFetch(async (_url, options) => {
    requestOptions = options;
    return jsonResponse({ uploadUrl: 'https://storage.example/upload' });
  }, async () => {
    await generateUploadUrl('test-token', 'main.txt', 'text/plain', null, 64);
    assert.equal(JSON.parse(requestOptions.body).size, 64);
  });
});

test('version upload rejects oversized files before requesting an upload URL', async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return jsonResponse({});
  }, async () => {
    await assert.rejects(
      uploadVersion('test-token', 'file-1', {
        name: 'large.bin',
        type: 'application/octet-stream',
        size: MAX_UPLOAD_SIZE_BYTES + 1,
      }),
      /maximum allowed size/i,
    );
    assert.equal(calls, 0);
  });
});
