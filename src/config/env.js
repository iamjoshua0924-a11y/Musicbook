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

module.exports = {
  env: optional('NODE_ENV', 'development'),
  port: Number(optional('PORT', '3000')),

  mongoUri: required('MONGODB_URI'),
  sessionSecret: required('SESSION_SECRET'),

  // Service account key is ALWAYS provided as base64 to avoid Render escaping issues.
  googleServiceAccountJsonBase64: required('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64'),
  driveRootFolderId: optional('GOOGLE_DRIVE_ROOT_FOLDER_ID', ''),

  publicBaseUrl: optional('PUBLIC_BASE_URL', ''),

  // Optional one-time bootstrap for first admin user (recommended for fresh DB).
  adminBootstrapToken: optional('ADMIN_BOOTSTRAP_TOKEN', ''),

  // Auto drive sync (production default: on, dev default: off)
  autoDriveSync: optional('AUTO_DRIVE_SYNC', optional('NODE_ENV', 'development') === 'production' ? '1' : '0') === '1',
  autoDriveSyncIntervalMin: Number(optional('AUTO_DRIVE_SYNC_INTERVAL_MIN', '10')),

  // CHZZK (chat ingestor PoC)
  chzzkChannelId: optional('CHZZK_CHANNEL_ID', ''),
  chzzkNidAut: optional('CHZZK_NID_AUT', ''),
  chzzkNidSes: optional('CHZZK_NID_SES', '')
};
