const {
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3Client, AWS_S3_BUCKET, isAwsConfigured } = require('../config/aws');

const ensureAwsConfigured = () => {
  if (isAwsConfigured) {
    return true;
  }

  if (
    !process.env.NODE_ENV ||
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test'
  ) {
    return false;
  }

  const error = new Error('File storage is temporarily unavailable.');
  error.statusCode = 503;
  throw error;
};

const sanitizeFileName = (fileName = 'file') => {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const generateUploadUrl = async (
  userId,
  originalName,
  mimeType = 'application/octet-stream',
  contentLength,
) => {
  const sanitizedName = sanitizeFileName(originalName || 'upload-file');
  const objectKey = `users/${userId}/${Date.now()}-${sanitizedName}`;

  if (!ensureAwsConfigured()) {
    return {
      uploadUrl: `https://local-dev.example.com/uploads/${objectKey}`,
      objectKey,
      bucket: AWS_S3_BUCKET || 'local-dev-bucket',
      mode: 'local-dev',
    };
  }

  const commandInput = {
    Bucket: AWS_S3_BUCKET,
    Key: objectKey,
    ContentType: mimeType,
    CacheControl: 'no-cache',
  };
  if (Number.isSafeInteger(contentLength)) {
    commandInput.ContentLength = contentLength;
  }
  const command = new PutObjectCommand(commandInput);

  let uploadUrl;
  try {
    uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
  } catch {
    const error = new Error('Unable to generate upload URL.');
    error.statusCode = 502;
    throw error;
  }

  return {
    uploadUrl,
    objectKey,
    bucket: AWS_S3_BUCKET,
    mode: 'aws',
  };
};

const generateDownloadUrl = async (userId, objectKey, disposition = 'attachment') => {
  if (!ensureAwsConfigured()) {
    return `https://local-dev.example.com/downloads/${encodeURIComponent(objectKey)}`;
  }

  const command = new GetObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: objectKey,
    ResponseContentDisposition: `${disposition}; filename="${objectKey.split('/').pop()}"`,
  });

  try {
    return await getSignedUrl(s3Client, command, { expiresIn: 300 });
  } catch {
    const error = new Error('Unable to generate download URL.');
    error.statusCode = 502;
    throw error;
  }
};

const verifyS3Object = async (objectKey) => {
  if (!ensureAwsConfigured()) {
    return null;
  }

  try {
    const result = await s3Client.send(
      new HeadObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: objectKey,
      })
    );

    if (typeof result.ContentLength !== 'number') {
      throw new Error('S3 object response did not include its content length.');
    }

    return { contentLength: result.ContentLength };
  } catch (error) {
    const notFound = error.name === 'NotFound'
      || error.name === 'NoSuchKey'
      || error.$metadata?.httpStatusCode === 404;
    const verificationError = new Error(
      notFound
        ? 'Uploaded file was not found in storage.'
        : 'Unable to verify uploaded file in storage.'
    );
    verificationError.statusCode = notFound ? 404 : 502;
    throw verificationError;
  }
};

const deleteS3Objects = async (userId, objectKeys) => {
  const uniqueKeys = [...new Set(objectKeys.filter((key) => typeof key === 'string' && key.length > 0))];
  if (!uniqueKeys.length || !ensureAwsConfigured()) {
    return { deletedKeys: [] };
  }

  const allowedPrefix = `users/${userId}/`;
  if (uniqueKeys.some((key) => !key.startsWith(allowedPrefix))) {
    const error = new Error('File storage operation is not permitted.');
    error.statusCode = 403;
    throw error;
  }

  const deletedKeys = [];
  for (const key of uniqueKeys) {
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: AWS_S3_BUCKET,
        Key: key,
      }));
      deletedKeys.push(key);
    } catch {
      const error = new Error('Unable to delete file from storage. Please retry.');
      error.statusCode = 502;
      error.deletedKeys = deletedKeys;
      throw error;
    }
  }

  return { deletedKeys };
};

module.exports = {
  generateUploadUrl,
  generateDownloadUrl,
  verifyS3Object,
  deleteS3Objects,
  sanitizeFileName,
};
