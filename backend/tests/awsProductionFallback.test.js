const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'production';
process.env.AWS_S3_BUCKET = '';
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;

const { generateUploadUrl, generateDownloadUrl } = require('../src/services/s3Service');

test('production never returns local-development S3 upload or download URLs', async () => {
  await assert.rejects(generateUploadUrl('user-1', 'file.txt', 'text/plain', 1), {
    statusCode: 503,
    message: 'File storage is temporarily unavailable.',
  });
  await assert.rejects(generateDownloadUrl('user-1', 'users/user-1/file.txt'), {
    statusCode: 503,
    message: 'File storage is temporarily unavailable.',
  });
});
