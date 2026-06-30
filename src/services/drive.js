const { google } = require('googleapis');
const { googleServiceAccountJsonBase64 } = require('../config/env');

let cachedDrive = null;
let cachedAuth = null;
let cachedReadonlyAuth = null;

function getServiceAccountCredentials() {
  // Base64 decode is FIXED by requirement.
  const json = JSON.parse(
    Buffer.from(googleServiceAccountJsonBase64, 'base64').toString('utf8')
  );
  return json;
}

function getDriveClient() {
  if (cachedDrive) return cachedDrive;

  const credentials = getServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    // NOTE: 파일명 변경을 위해 write scope가 필요하다.
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  cachedAuth = auth;
  cachedDrive = google.drive({ version: 'v3', auth });
  return cachedDrive;
}

function getDriveReadonlyAuth() {
  if (cachedReadonlyAuth) return cachedReadonlyAuth;
  const credentials = getServiceAccountCredentials();
  cachedReadonlyAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  return cachedReadonlyAuth;
}

async function getReadonlyAccessToken() {
  const auth = getDriveReadonlyAuth();
  const client = await auth.getClient();
  try {
    if (typeof client.authorize === 'function') await client.authorize();
  } catch {}
  const tokenObj = await client.getAccessToken();
  const accessToken =
    (typeof tokenObj === 'string' ? tokenObj : tokenObj?.token) ||
    tokenObj?.res?.data?.access_token ||
    client?.credentials?.access_token ||
    '';
  if (!accessToken) throw new Error('ACCESS_TOKEN_MISSING');
  const expiresAt = Number(client?.credentials?.expiry_date || 0) || Date.now() + 50 * 60 * 1000;
  return { accessToken, expiresAt };
}

async function getFileMetadata(fileId) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
    supportsAllDrives: true,
    fields: 'id,name,mimeType,size,modifiedTime,capabilities/canDownload,permissions(type,role)'
  });
  return res.data;
}

async function renameFile(fileId, name) {
  const drive = getDriveClient();
  const res = await drive.files.update({
    fileId,
    requestBody: { name: String(name || '').trim() },
    fields: 'id,name'
  });
  return res.data;
}

function buildPreviewUrl(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

function buildViewUrl(fileId) {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

module.exports = {
  getDriveClient,
  getDriveReadonlyAuth,
  getReadonlyAccessToken,
  getFileMetadata,
  renameFile,
  buildPreviewUrl,
  buildViewUrl
};
