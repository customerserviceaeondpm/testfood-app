import { google } from 'googleapis';

// Hanya dipakai di server (API routes). Membutuhkan 2 environment variable:
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
export function getSheetsClient() {
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}
