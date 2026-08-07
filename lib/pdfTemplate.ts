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

// Mengecek apakah sebuah URL benar-benar bisa diakses publik tanpa autentikasi,
// persis seperti Google akan mengaksesnya saat merender formula IMAGE().
// Kalau gagal, kita tahu penyebab #REF! adalah URL-nya sendiri, bukan hal lain.
async function isPubliclyReachableImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || '';
    return contentType.startsWith('image/');
  } catch {
    return false;
  }
}

export async function generatePdfFromTemplate(
  data: any,
  namaPic: string,
  sigPicUrl: string | null,
  supabase: any
): Promise<{ url: string; warnings: string[] }> {
  const auth = getGoogleAuth();
  const sheets = getSheetsClient();
  const drive = getDriveClient();
  const warnings: string[] = [];

  let tempSpreadsheetId: string | null = null;

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SOURCE_SHEET_ID });
    const templateSheet = meta.data.sheets?.find((s) => s.properties?.title === 'Template_PDF');
    if (!templateSheet || templateSheet.properties?.sheetId == null) {
      throw new Error('Sheet "Template_PDF" tidak ditemukan di spreadsheet sumber.');
    }
    const templateSheetId = templateSheet.properties.sheetId;

    const createRes = await drive.files.create({
      requestBody: {
        name: `Temp_${data.tanggal}_${data.waktu}`,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [DRIVE_FOLDER_ID],
      },
      fields: 'id',
    });
    tempSpreadsheetId = createRes.data.id!;

    const tempMeta = await sheets.spreadsheets.get({ spreadsheetId: tempSpreadsheetId });
    const defaultSheetId = tempMeta.data.sheets![0].properties!.sheetId!;

    const copyRes = await sheets.spreadsheets.sheets.copyTo({
      spreadsheetId: SOURCE_SHEET_ID,
      sheetId: templateSheetId,
      requestBody: { destinationSpreadsheetId: tempSpreadsheetId },
    });
    const newSheetId = copyRes.data.sheetId!;

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
      spreadsheetId: tempSpreadsheetId,
      requestBody: {
        requests: [
          { deleteSheet: { sheetId: defaultSheetId } },
          {
            updateSheetProperties: {
              properties: { sheetId: newSheetId, title: 'Report' },
              fields: 'title',
            },
          },
          {
            updateCells: {
              range: {
                sheetId: newSheetId,
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

    // Upload tanda tangan MOD ke Supabase Storage
    let sigModUrl: string | null = null;
    if (data.sigMOD && typeof data.sigMOD === 'string' && data.sigMOD.startsWith('data:image')) {
      const base64 = data.sigMOD.split(',')[1];
      const buffer = Buffer.from(base64, 'base64');
      const fileName = `mod_${data.tanggal}_${data.waktu}_${Date.now()}.png`;
      const { error } = await supabase.storage
        .from('signatures')
        .upload(fileName, buffer, { contentType: 'image/png', upsert: true });
      if (!error) {
        const { data: pub } = supabase.storage.from('signatures').getPublicUrl(fileName);
        sigModUrl = pub.publicUrl;
      } else {
        warnings.push(`Gagal upload TTD MOD ke Storage: ${error.message}`);
      }
    }

    // VERIFIKASI: cek beneran bisa diakses publik tanpa login, SEBELUM dipakai di formula IMAGE().
    // Kalau gagal, jangan paksa masukkan formula (supaya tidak jadi #REF!) - catat sebagai warning saja.
    if (sigModUrl) {
      const reachable = await isPubliclyReachableImage(sigModUrl);
      if (!reachable) {
        warnings.push(
          `TTD MOD tidak bisa diakses publik (cek policy bucket 'signatures' di Supabase Storage harus public/read). URL: ${sigModUrl}`
        );
        sigModUrl = null;
      }
    }
    if (sigPicUrl) {
      const reachable = await isPubliclyReachableImage(sigPicUrl);
      if (!reachable) {
        warnings.push(
          `TTD PIC tidak bisa diakses publik (cek policy bucket 'signatures' di Supabase Storage harus public/read). URL: ${sigPicUrl}`
        );
        sigPicUrl = null;
      }
    }

    const valueRanges: { range: string; values: any[][] }[] = [
      { range: 'Report!B2', values: [[data.tanggal]] },
      { range: 'Report!E3', values: [[data.waktu === 'PAGI' ? '09:00 - 10:00' : '16:00 - 17:00']] },
      { range: 'Report!B4', values: [[`Pak ${data.mod || ''}`]] },
      { range: 'Report!H2', values: [[`1. ${data.testers?.[0] || ''}`]] },
      { range: 'Report!I2', values: [[`2. ${data.testers?.[1] || ''}`]] },
      { range: 'Report!H3', values: [[`3. ${data.testers?.[2] || ''}`]] },
      { range: 'Report!I3', values: [[`4. ${data.testers?.[3] || ''}`]] },
      { range: 'Report!H35', values: [[(data.mod || 'MOD').toUpperCase()]] },
      { range: 'Report!I35', values: [[(namaPic || 'PIC').toUpperCase()]] },
    ];

    if (sigModUrl) {
      valueRanges.push({ range: 'Report!H29', values: [[`=IMAGE("${sigModUrl}",4,75,145)`]] });
    }
    if (sigPicUrl) {
      valueRanges.push({ range: 'Report!I29', values: [[`=IMAGE("${sigPicUrl}",4,75,145)`]] });
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
          range: `Report!A${row}:E${row}`,
          values: [[cat, counts[cat] + 1, item.nama, item.nilai, item.comment]],
        });
        counts[cat]++;
      }
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: tempSpreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: valueRanges },
    });

    // Jeda lebih panjang (8 detik) supaya formula IMAGE() sempat selesai mengambil gambar
    // sebelum sheet di-export. Race condition ini penyebab umum #REF! kalau URL sebenarnya valid.
    if (sigModUrl || sigPicUrl) {
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }

    const accessTokenRes = await auth.getAccessToken();
    const accessToken = typeof accessTokenRes === 'string' ? accessTokenRes : accessTokenRes?.token;
    if (!accessToken) throw new Error('Gagal mendapatkan access token Google.');

    const exportUrl =
      `https://docs.google.com/spreadsheets/d/${tempSpreadsheetId}/export` +
      `?format=pdf&size=A4&portrait=false&fitw=true&gridlines=false&gid=${newSheetId}`;

    const pdfRes = await fetch(exportUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!pdfRes.ok) {
      throw new Error(`Gagal export PDF dari Google Sheets (status ${pdfRes.status})`);
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

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
  } finally {
    if (tempSpreadsheetId) {
      try {
        await drive.files.delete({ fileId: tempSpreadsheetId });
      } catch {
        // gagal hapus bukan fatal
      }
    }
  }
}
