const { google } = require('googleapis');
const { googleServiceAccountJsonBase64 } = require('../config/env');

let cachedDrive = null;
let cachedAuth = null;

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

/**
 * Render가 PDF 바이트를 중계하지 않도록, Drive 직접 다운로드 URL을 발급한다.
 * - access_token이 URL에 포함되므로 만료 시간을 짧게(기본 15분) 잡는다.
 * - 클라이언트는 이 URL로 Google API에 직접 요청한다.
 */
async function getSignedDownloadUrl(fileId, expiresInSeconds = 900) {
  // getDriveClient() 호출로 auth 캐시 보장
  getDriveClient();
  const auth = cachedAuth;
  if (!auth) throw new Error('AUTH_NOT_READY');

  const client = await auth.getClient();
  const tokenObj = await client.getAccessToken();
  const accessToken = typeof tokenObj === 'string' ? tokenObj : tokenObj?.token;
  if (!accessToken) throw new Error('ACCESS_TOKEN_MISSING');

  // Shared Drive 대응: supportsAllDrives=true
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?alt=media&supportsAllDrives=true&access_token=${encodeURIComponent(accessToken)}`;
  return { url, expiresAt: Date.now() + Number(expiresInSeconds || 900) * 1000 };
}

async function getFileMetadata(fileId) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
    supportsAllDrives: true,
    fields: 'id,name,mimeType,size,modifiedTime'
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

module.exports = { getDriveClient, getFileMetadata, renameFile, buildPreviewUrl, buildViewUrl, getSignedDownloadUrl };
