require('dotenv').config();
const { S3Client } = require('@aws-sdk/client-s3');

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;
const hasAwsCredentials = Boolean(
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
);
const hasAwsProfile = Boolean(
  process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE || process.env.AWS_SDK_LOAD_CONFIG
);

const getAwsStatus = () => {
  const credentialsConfigured = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );
  const profileConfigured = Boolean(
    process.env.AWS_PROFILE || process.env.AWS_DEFAULT_PROFILE || process.env.AWS_SDK_LOAD_CONFIG
  );
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION || 'us-east-1';
  const credentialSource = credentialsConfigured ? 'environment' : profileConfigured ? 'profile' : 'none';

  return {
    configured: Boolean(bucket && region && (credentialsConfigured || profileConfigured)),
    region,
    bucket: bucket || null,
    credentialSource,
    missing: {
      bucket: !bucket,
      region: !region,
      credentials: !(credentialsConfigured || profileConfigured),
    },
  };
};

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: hasAwsCredentials
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

const isAwsConfigured = Boolean(
  AWS_S3_BUCKET && AWS_REGION && (hasAwsCredentials || hasAwsProfile)
);

module.exports = {
  s3Client,
  AWS_REGION,
  AWS_S3_BUCKET,
  isAwsConfigured,
  hasAwsCredentials,
  hasAwsProfile,
  getAwsStatus,
};
