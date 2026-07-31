import { google } from 'googleapis';

// Pakai OAuth2 dengan refresh token akun Google asli (bukan service account),
// supaya semua file yang dibuat (spreadsheet sementara, PDF laporan) benar-benar
// tercatat sebagai milik akun itu dan memakai kuota penyimpanan asli akun tersebut -
// bukan kuota service account yang selalu 0 byte.
export function getGoogleAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  });

  return oauth2Client;
}
