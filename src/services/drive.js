const { Readable } = require('stream');
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

// 새 악보 파일을 Drive 루트(또는 임의 폴더)에 업로드한다. 업로드 UI(단일/벌크/악보 연결)에서 공용으로 쓴다.
// 권한은 부모 폴더의 공유 설정을 그대로 상속받는다(별도로 permissions.create를 호출하지 않음) —
// driveSync가 인식하는 루트 폴더가 이미 "공유된 폴더"라는 전제이므로, 사람이 드래그해서 올린 파일과
// 동일하게 폴더 공유 설정이 자동으로 적용된다.
async function createFile(parentFolderId, name, mimeType, buffer) {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name: String(name || '').trim(),
      parents: [String(parentFolderId || '').trim()]
    },
    media: {
      mimeType,
      body: Readable.from(buffer)
    },
    supportsAllDrives: true,
    fields: 'id,name,webViewLink'
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
  createFile,
  renameFile,
  buildPreviewUrl,
  buildViewUrl
};
