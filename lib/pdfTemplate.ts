import { Readable } from 'stream';
import { getGoogleAuth } from './googleAuth';
import { getSheetsClient } from './googleSheets';
import { getDriveClient } from './googleDrive';

const SOURCE_SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID!;

// Posisi baris tiap counter di Template_PDF, persis meniru counterMap di processForm() lama.
// Kalau layout Template_PDF pernah diubah, angka-angka ini juga perlu disesuaikan.
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

/**
 * Membuat PDF laporan test food memakai sheet "Template_PDF" sebagai cetakan,
 * lalu menyimpannya ke folder Google Drive (GOOGLE_DRIVE_FOLDER_ID).
 *
 * Alurnya meniru persis processForm() di Apps Script lama:
 * 1. Salin sheet Template_PDF ke spreadsheet sementara
 * 2. Isi tanggal, shift, MOD, tester, daftar produk per counter, tanda tangan
 * 3. Export sheet itu sebagai PDF lewat endpoint export bawaan Google Sheets
 * 4. Upload hasil PDF ke folder Drive
 * 5. Hapus spreadsheet sementara
 */
export async function generatePdfFromTemplate(
  data: any,
  namaPic: string,
  sigPicUrl: string | null,
  supabase: any
): Promise<string> {
  const auth = getGoogleAuth();
  const sheets = getSheetsClient();
  const drive = getDriveClient();

  let tempSpreadsheetId: string | null = null;

  try {
    // 1. Cari sheetId dari tab "Template_PDF" di spreadsheet sumber
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SOURCE_SHEET_ID });
    const templateSheet = meta.data.sheets?.find((s) => s.properties?.title === 'Template_PDF');
    if (!templateSheet || templateSheet.properties?.sheetId == null) {
      throw new Error('Sheet "Template_PDF" tidak ditemukan di spreadsheet sumber.');
    }
    const templateSheetId = templateSheet.properties.sheetId;

    // 2. Buat spreadsheet sementara
    const createRes = await sheets.spreadsheets.create({
      requestBody: { properties: { title: `Temp_${data.tanggal}_${data.waktu}` } },
    });
    tempSpreadsheetId = createRes.data.spreadsheetId!;
    const defaultSheetId = createRes.data.sheets![0].properties!.sheetId!;

    // 3. Salin sheet Template_PDF ke spreadsheet sementara
    const copyRes = await sheets.spreadsheets.sheets.copyTo({
      spreadsheetId: SOURCE_SHEET_ID,
      sheetId: templateSheetId,
      requestBody: { destinationSpreadsheetId: tempSpreadsheetId },
    });
    const newSheetId = copyRes.data.sheetId!;

    // 4. Hapus sheet default bawaan, ganti nama sheet hasil salinan jadi "Report",
    //    dan atur coret PAGI/SORE - digabung jadi satu batchUpdate biar cepat
    const strikeStart = data.waktu === 'PAGI' ? 7 : 0;
    const strikeEnd = data.waktu === 'PAGI' ? 11 : 4;

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
                      userEnteredValue: { stringValue: 'PAGI / SORE' },
                      textFormatRuns: [
                        { startIndex: 0, format: {} },
                        { startIndex: strikeStart, format: { strikethrough: true } },
                        { startIndex: strikeEnd, format: { strikethrough: false } },
                      ],
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

    // 5. Upload tanda tangan MOD (base64 dari client) ke Supabase Storage supaya ada URL publik
    //    (Google Sheets IMAGE() butuh URL yang bisa diakses publik, bukan base64 langsung)
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
      }
    }

    // 6. Susun semua nilai yang mau diisi ke template
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

    // Tanda tangan pakai formula =IMAGE() yang merender gambar dari URL langsung di dalam sel,
    // ukuran 145x145px mode custom (mode 4), meniru setWidth(145)/setHeight(75) di kode lama
    if (sigModUrl) {
      valueRanges.push({ range: 'Report!H29', values: [[`=IMAGE("${sigModUrl}",4,75,145)`]] });
    }
    if (sigPicUrl) {
      valueRanges.push({ range: 'Report!I29', values: [[`=IMAGE("${sigPicUrl}",4,75,145)`]] });
    }

    // Isi baris produk per counter, logika persis sama seperti processForm() lama
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

    // 7. Beri jeda sebentar supaya formula =IMAGE() selesai memuat gambar sebelum di-export
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 8. Export sheet sebagai PDF lewat endpoint export bawaan Google Sheets
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

    // 9. Upload PDF ke folder Google Drive
    const fileName = `Report_TestFood_${data.tanggal}_${data.waktu}.pdf`;
    const driveRes = await drive.files.create({
      requestBody: { name: fileName, parents: [DRIVE_FOLDER_ID] },
      media: { mimeType: 'application/pdf', body: Readable.from(pdfBuffer) },
      fields: 'id, webViewLink',
    });

    const fileId = driveRes.data.id!;

    // 10. Coba buka akses "siapa saja yang punya link bisa lihat".
    //     Kalau kebijakan Google Workspace organisasi memblokir sharing publik,
    //     langkah ini boleh gagal - PDF-nya tetap tersimpan di folder Drive,
    //     tinggal diakses oleh siapa saja yang sudah punya akses ke folder itu.
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    } catch (permErr: any) {
      console.error('Gagal set permission publik (dilewati, file tetap tersimpan):', permErr?.message || permErr);
    }

    return driveRes.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
  } finally {
    // 11. Hapus spreadsheet sementara apapun hasilnya, supaya Drive tidak numpuk file sampah
    if (tempSpreadsheetId) {
      try {
        await drive.files.delete({ fileId: tempSpreadsheetId });
      } catch {
        // gagal hapus bukan fatal, cuma nyisa 1 file - diamkan
      }
    }
  }
}
