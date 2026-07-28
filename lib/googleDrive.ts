import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth';

export function getDriveClient() {
  return google.drive({ version: 'v3', auth: getGoogleAuth() });
}
