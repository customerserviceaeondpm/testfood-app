import { Readable } from 'stream';
import { getGoogleAuth } from './googleAuth';
import { getSheetsClient } from './googleSheets';
import { getDriveClient } from './googleDrive';

const SOURCE_SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!;

const COUNTER_MAP: Record<string, number> = {
  SUSHI: 6,
  MINISTOP: 9,
  TEMPURA: 12,
  TEPPANYAKI: 15,
  CHICKEN: 18,
  BAKERY: 21,
  'CUT FRUIT': 24,
  JUICE: 27,
  'REWARD KITCHEN': 30,
  OTHERS: 33,
};



async function acquireLock(sheets: any): Promise<boolean> {
  try {
    const lockCheck = await sheets.spreadsheets.values.get({
      spreadsheetId: SOURCE_SHEET_ID,
      range: 'Template_PDF!Z1:Z2',
    });
    
    const lockStatus = lockCheck.data.values?.[0]?.[0];
    const lockTimestamp = lockCheck.data.values?.[1]?.[0];
    
    if (lockStatus === 'LOCKED') {
      const now = Date.now();
      const lockTime = parseInt(lockTimestamp || '0', 10);
      const lockAge = now - lockTime;
      
      if (lockAge < 300000) {
        return false;
      }
    }
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: SOURCE_SHEET_ID,
      range: 'Template_PDF!Z1:Z2',
      valueInputOption: 'RAW',
      requestBody: { values: [['LOCKED'], [Date.now().toString()]] },
    });
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(sheets: any): Promise<void> {
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SOURCE_SHEET_ID,
      range: 'Template_PDF!Z1:Z2',
    });
  } catch {
    // gagal release lock bukan fatal
  }
}

async function backupTemplateData(sheets: any): Promise<Map<string, any[][]>> {
  const backup = new Map<string, any[][]>();
  const rangesToBackup = [
    'Template_PDF!B2',
    'Template_PDF!B4',
    'Template_PDF!E3',
    'Template_PDF!H2:I3',
    'Template_PDF!H29:I35',
    'Template_PDF!H35:I35',
    'Template_PDF!A6:E45',
  ];

  for (const range of rangesToBackup) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SOURCE_SHEET_ID,
        range,
      });
      backup.set(range, res.data.values || []);
    } catch {
      backup.set(range, []);
    }
  }
  return backup;
}

async function restoreTemplateData(sheets: any, backup: Map<string, any[][]>): Promise<void> {
  const clearRanges = Array.from(backup.keys());
  try {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: SOURCE_SHEET_ID,
      requestBody: { ranges: clearRanges },
    });
  } catch (err) {
    console.error('Gagal clear template data:', err);
  }
}

export async function generatePdfFromTemplate(
  data: any,
  namaPic: string,
  sigPicUrlInput: string | null,
  supabase: any
): Promise<{ url: string; warnings: string[] }> {
  const auth = getGoogleAuth();
  const sheets = getSheetsClient();
  const drive = getDriveClient();
  const warnings: string[] = [];

  let lockAcquired = false;
  let backup: Map<string, any[][]> | null = null;

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SOURCE_SHEET_ID });
    const templateSheet = meta.data.sheets?.find((s: any) => s.properties?.title === 'Template_PDF');
    if (!templateSheet || templateSheet.properties?.sheetId == null) {
      throw new Error('Sheet "Template_PDF" tidak ditemukan di spreadsheet sumber.');
    }
    const templateSheetId = templateSheet.properties.sheetId;

    lockAcquired = await acquireLock(sheets);
    if (!lockAcquired) {
      throw new Error('Export sedang berjalan. Coba lagi dalam 30 detik.');
    }

    backup = await backupTemplateData(sheets);

    const headerText = 'PAGI / SORE';
    const strikeStart = data.waktu === 'PAGI' ? 7 : 0;
    const strikeEnd = data.waktu === 'PAGI' ? 11 : 4;

    const textFormatRuns: { startIndex: number; format: any }[] = [];
    if (strikeStart > 0) {
      textFormatRuns.push({ startIndex: 0, format: {} });
    }
    textFormatRuns.push({ startIndex: strikeStart, format: { strikethrough: true } });
    if (strikeEnd < headerText.length) {
      textFormatRuns.push({ startIndex: strikeEnd, format: { strikethrough: false } });
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SOURCE_SHEET_ID,
      requestBody: {
        requests: [
          {
            updateCells: {
              range: {
                sheetId: templateSheetId,
                startRowIndex: 2,
                endRowIndex: 3,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
              rows: [
                {
                  values: [
                    {
                      userEnteredValue: { stringValue: headerText },
                      textFormatRuns,
                    },
                  ],
                },
              ],
              fields: 'userEnteredValue,textFormatRuns',
            },
          },
        ],
      },
    });

    let sigModUrl: string | null = data.sigModUrl || null;

    let sigPicUrl = sigPicUrlInput;

    const valueRanges: { range: string; values: any[][] }[] = [
      { range: 'Template_PDF!B2', values: [[data.tanggal]] },
      { range: 'Template_PDF!E3', values: [[data.waktu === 'PAGI' ? '09:00 - 10:00' : '16:00 - 17:00']] },
      { range: 'Template_PDF!B4', values: [[`Pak ${data.mod || ''}`]] },
      { range: 'Template_PDF!H2', values: [[`1. ${data.testers?.[0] || ''}`]] },
      { range: 'Template_PDF!I2', values: [[`2. ${data.testers?.[1] || ''}`]] },
      { range: 'Template_PDF!H3', values: [[`3. ${data.testers?.[2] || ''}`]] },
      { range: 'Template_PDF!I3', values: [[`4. ${data.testers?.[3] || ''}`]] },
      { range: 'Template_PDF!H35', values: [[(data.mod || 'MOD').toUpperCase()]] },
      { range: 'Template_PDF!I35', values: [[(namaPic || 'PIC').toUpperCase()]] },
    ];

    if (sigModUrl) {
      valueRanges.push({ range: 'Template_PDF!H29', values: [[`=IMAGE("${sigModUrl}")`]] });
    }
    if (sigPicUrl) {
      valueRanges.push({ range: 'Template_PDF!I29', values: [[`=IMAGE("${sigPicUrl}")`]] });
    }

    const counts: Record<string, number> = {};
    Object.keys(COUNTER_MAP).forEach((k) => (counts[k] = 0));

    for (const item of data.items || []) {
      let cat = String(item.counter || 'OTHERS').toUpperCase().trim();
      if (!COUNTER_MAP[cat]) cat = 'OTHERS';
      if (cat !== 'OTHERS' && counts[cat] >= 3) cat = 'OTHERS';

      const baseRow = COUNTER_MAP[cat];
      const row = cat === 'OTHERS' ? baseRow + counts[cat] : baseRow + (counts[cat] % 3);

      if (row >= 6 && row <= 45) {
        valueRanges.push({
          range: `Template_PDF!A${row}:E${row}`,
          values: [[cat, counts[cat] + 1, item.nama, item.nilai, item.comment]],
        });
        counts[cat]++;
      }
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SOURCE_SHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: valueRanges },
    });

    await new Promise(resolve => setTimeout(resolve, 3000));
    await releaseLock(sheets);

    const accessTokenRes = await auth.getAccessToken();
    const accessToken = typeof accessTokenRes === 'string' ? accessTokenRes : accessTokenRes?.token;
    if (!accessToken) throw new Error('Gagal mendapatkan access token Google.');

    const exportUrl =
      `https://docs.google.com/spreadsheets/d/${SOURCE_SHEET_ID}/export` +
      `?format=pdf&size=A4&portrait=false&fitw=true&gridlines=false&gid=${templateSheetId}`;

    const pdfRes = await fetch(exportUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!pdfRes.ok) {
      throw new Error(`Gagal export PDF dari Google Sheets (status ${pdfRes.status})`);
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    const DEST_FOLDER_ID = '1RnnandGlU_k4CBW2DcJlXHZNxHTwA7Xw';
    try {
      const tempSpreadsheetId = (await drive.files.create({
        requestBody: {
          name: `Report_TestFood_${data.tanggal}_${data.waktu}`,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [DEST_FOLDER_ID],
        },
        fields: 'id',
      })).data.id!;

      const copyRes = await sheets.spreadsheets.sheets.copyTo({
        spreadsheetId: SOURCE_SHEET_ID,
        sheetId: templateSheetId,
        requestBody: { destinationSpreadsheetId: tempSpreadsheetId },
      });
    } catch (copyErr: any) {
      warnings.push('Gagal menyalin spreadsheet ke folder tujuan: ' + (copyErr?.message || copyErr.toString()));
    }

    const fileName = `Report_TestFood_${data.tanggal}_${data.waktu}.pdf`;
    const driveRes = await drive.files.create({
      requestBody: { name: fileName, parents: [DRIVE_FOLDER_ID] },
      media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
      fields: 'id, webViewLink',
    });

    const fileId = driveRes.data.id!;

    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    } catch (permErr: any) {
      console.error('Gagal set permission publik (dilewati, file tetap tersimpan):', permErr?.message || permErr);
    }

    const url = driveRes.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
    return { url, warnings };
  } catch (err: any) {
    if (lockAcquired) {
      await releaseLock(sheets);
    }
    throw err;
  } finally {
    if (backup) {
      await restoreTemplateData(sheets, backup);
    }
  }
}
