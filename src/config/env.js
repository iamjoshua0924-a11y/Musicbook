const dotenv = require('dotenv');

dotenv.config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function optional(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined ? fallback : v;
}

function requiredAny(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing required env: one of [${names.join(', ')}]`);
}

module.exports = {
  env: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '3000')),

  // Render/호스팅 환경에 따라 변수명이 다를 수 있어 둘 다 지원
  mongoUri: requiredAny(['MONGODB_URI', 'MONGO_URI']),
  sessionSecret: required('SESSION_SECRET'),

  // Service account key is ALWAYS provided as base64 to avoid Render escaping issues.
  googleServiceAccountJsonBase64: required('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64'),
  driveRootFolderId: optional('GOOGLE_DRIVE_ROOT_FOLDER_ID', ''),

  publicBaseUrl: optional('PUBLIC_BASE_URL', ''),

  // Optional one-time bootstrap for first admin user (recommended for fresh DB).
  adminBootstrapToken: optional('ADMIN_BOOTSTRAP_TOKEN', ''),

  // CHZZK (chat ingestor PoC)
  chzzkChannelId: optional('CHZZK_CHANNEL_ID', ''),
  chzzkNidAut: optional('CHZZK_NID_AUT', ''),
  chzzkNidSes: optional('CHZZK_NID_SES', ''),

  // Developer console (optional)
  devToken: optional('DEV_TOKEN', optional('MUSICBOOK_DEV_TOKEN', ''))
};
