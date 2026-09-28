import { Readable } from 'stream';
import { PDFDocument } from 'pdf-lib';
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

// Sel anchor tempat tanda tangan seharusnya berada di template (0-indexed): H29 dan I29
const SIG_MOD_ANCHOR = { row: 28, col: 7 };
const SIG_PIC_ANCHOR = { row: 28, col: 8 };

// Padding kecil di dalam kotak (px skala sheet), meniru "Offset 2px" di kode Apps Script lama
const BOX_PADDING_PX = 2;

// Margin halaman export PDF Google Sheets (pt). Export pakai margin default,
// grid tidak mulai di 0,0 halaman. Tanpa ini X/Y selalu geser.
const MARGIN_LEFT_PT = 36;
const MARGIN_RIGHT_PT = 36;
const MARGIN_TOP_PT = 36;
const MARGIN_BOTTOM_PT = 36;

// Kolom terakhir yang ikut tercetak di PDF (A..I = 9 kolom, index 0-8).
// Dipakai untuk menghitung skala px->pt hasil export. Sesuaikan kalau layout template berubah.
const LAST_PRINTED_COLUMN_INDEX = 8;

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

async function getGridMetadata(sheets: any, spreadsheetId: string) {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: ['Report'],
    fields: 'sheets.merges,sheets.data.rowMetadata,sheets.data.columnMetadata',
  });
  const sheetData = res.data.sheets?.[0];
  const gridData = sheetData?.data?.[0];
  return {
    merges: sheetData?.merges || [],
    columnMetadata: gridData?.columnMetadata || [],
    rowMetadata: gridData?.rowMetadata || [],
  };
}

// Jumlah pixel kumulatif dari kolom/baris ke-0 sampai sebelum index tertentu.
function cumulativePixels(metadataList: any[], count: number, defaultPx: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += metadataList[i]?.pixelSize ?? defaultPx;
  }
  return total;
}

// Cari merged cell yang menaungi sel anchor tertentu. Kalau sel itu ternyata
// tidak digabung (bukan merge), anggap batasnya cuma sel itu sendiri (1x1).
function findBoxRange(merges: any[], anchor: { row: number; col: number }) {
  const merge = merges.find(
    (m: any) =>
      anchor.row >= m.startRowIndex && anchor.row < m.endRowIndex &&
      anchor.col >= m.startColumnIndex && anchor.col < m.endColumnIndex
  );
  if (merge) return merge;
  return {
    startRowIndex: anchor.row,
    endRowIndex: anchor.row + 1,
    startColumnIndex: anchor.col,
    endColumnIndex: anchor.col + 1,
  };
}

/**
 * Tempelkan gambar tanda tangan langsung ke PDF hasil export, pas di dalam batas
 * kotak tanda tangan ASLI di template (dibaca dari info merged cell-nya langsung,
 * bukan tebakan offset manual) - dikonversi ke satuan poin PDF pakai skala hasil export.
 *
 * Kenapa begini, bukan formula IMAGE() di sheet: Google Sheets API v4 tidak selalu
 * benar-benar merender formula IMAGE() saat diakses murni lewat API (berbeda dari saat
 * dibuka manual di browser), dan API ini juga tidak menyediakan cara menyisipkan gambar
 * mengambang (floating image) seperti SpreadsheetApp.insertImage() di Apps Script -
 * itu fitur khusus Apps Script yang tidak diekspos di REST API. Jadi gambar ditempel
 * langsung ke file PDF akhir, bukan dititipkan ke proses render Google.
 */
async function overlaySignatures(
  pdfBuffer: Buffer,
  sheets: any,
  tempSpreadsheetId: string,
  sigModUrl: string | null,
  sigPicUrl: string | null
): Promise<any> {
  const { merges, columnMetadata, rowMetadata } = await getGridMetadata(sheets, tempSpreadsheetId);

  const totalGridWidthPx = cumulativePixels(columnMetadata, LAST_PRINTED_COLUMN_INDEX + 1, 100);

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const page = pdfDoc.getPages()[0];
  const pageWidthPt = page.getWidth();
  const pageHeightPt = page.getHeight();
  const scale = pageWidthPt / totalGridWidthPx;

  async function draw(url: string, anchor: { row: number; col: number }) {
    const box = findBoxRange(merges, anchor);

    const leftPx = cumulativePixels(columnMetadata, box.startColumnIndex, 100) + BOX_PADDING_PX;
    const rightPx = cumulativePixels(columnMetadata, box.endColumnIndex, 100) - BOX_PADDING_PX;
    const topPx = cumulativePixels(rowMetadata, box.startRowIndex, 21) + BOX_PADDING_PX;
    const bottomPx = cumulativePixels(rowMetadata, box.endRowIndex, 21) - BOX_PADDING_PX;

    const boxWidthPt = Math.max(rightPx - leftPx, 1) * scale;
    const boxHeightPt = Math.max(bottomPx - topPx, 1) * scale;

    // Google Sheets export PDF memasukkan margin default 36pt di semua sisi.
    // Koordinat x, y perlu ditambah margin agar sesuai posisi sel di template.
    const xPt = leftPx * scale + MARGIN_LEFT_PT;
    const yPt = pageHeightPt - bottomPx * scale - MARGIN_TOP_PT; // PDF origin di kiri-bawah, sheet origin di kiri-atas

    const imgRes = await fetch(url);
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    const pngImage = await pdfDoc.embedPng(imgBytes);

    page.drawImage(pngImage, { x: xPt, y: yPt, width: boxWidthPt, height: boxHeightPt });
  }

  if (sigModUrl) await draw(sigModUrl, SIG_MOD_ANCHOR);
  if (sigPicUrl) await draw(sigPicUrl, SIG_PIC_ANCHOR);

  const savedBytes = await pdfDoc.save();
  return Buffer.from(savedBytes) as any;
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

  let tempSpreadsheetId: string | null = null;

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SOURCE_SHEET_ID });
    const templateSheet = meta.data.sheets?.find((s: any) => s.properties?.title === 'Template_PDF');
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

    let sigPicUrl = sigPicUrlInput;
    if (sigModUrl && !(await isPubliclyReachableImage(sigModUrl))) {
      warnings.push(`TTD MOD tidak bisa diakses publik. URL: ${sigModUrl}`);
      sigModUrl = null;
    }
    if (sigPicUrl && !(await isPubliclyReachableImage(sigPicUrl))) {
      warnings.push(`TTD PIC tidak bisa diakses publik. URL: ${sigPicUrl}`);
      sigPicUrl = null;
    }

    // Isi data teks (tanggal, MOD, tester, daftar produk per counter).
    // Tanda tangan TIDAK ditulis sebagai formula IMAGE() di sini - lihat overlaySignatures().
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
    let pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    // Tempel tanda tangan langsung ke PDF hasil export
    if (sigModUrl || sigPicUrl) {
      try {
        pdfBuffer = await overlaySignatures(pdfBuffer, sheets, tempSpreadsheetId, sigModUrl, sigPicUrl);
      } catch (overlayErr: any) {
        warnings.push('Gagal menempelkan tanda tangan ke PDF: ' + (overlayErr?.message || overlayErr.toString()));
      }
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
