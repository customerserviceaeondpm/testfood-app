import { google } from 'googleapis';
import { getGoogleAuth } from './googleAuth';

export function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() });
}
