const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

test('health endpoint is available', async () => {
  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, 'ok');
  } finally {
    server.close();
  }
});

test('register endpoint creates a user with valid payload', async () => {
  const app = createApp();
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Test User',
        email: 'test@example.com',
        password: 'StrongPass123!',
      }),
    });

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.user.email, 'test@example.com');
    assert.ok(payload.token);

    const meResponse = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${payload.token}`,
      },
    });

    assert.equal(meResponse.status, 200);
    const mePayload = await meResponse.json();
    assert.equal(mePayload.user.email, 'test@example.com');
  } finally {
    server.close();
  }
});
