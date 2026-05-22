const { google } = require('googleapis');
const { googleServiceAccountJsonBase64 } = require('../config/env');

let cachedDrive = null;

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

  cachedDrive = google.drive({ version: 'v3', auth });
  return cachedDrive;
}

async function getFileMetadata(fileId) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
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

module.exports = { getDriveClient, getFileMetadata, renameFile, buildPreviewUrl, buildViewUrl };
