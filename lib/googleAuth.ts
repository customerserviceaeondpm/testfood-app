import { google } from 'googleapis';

// JWT auth ini dipakai bersama oleh Sheets API dan Drive API,
// supaya tidak perlu bikin client terpisah-pisah dengan scope berbeda.
export function getGoogleAuth() {
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
}
