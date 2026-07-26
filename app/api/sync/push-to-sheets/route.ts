import { getSupabase } from '@/lib/supabase';
import { getSheetsClient } from '@/lib/googleSheets';
import { isSyncAuthorized } from '@/lib/syncAuth';

const SHEET_NAME = 'Database_Sync'; // tab terpisah, supaya tidak bentrok dengan sheet "Database" lama

export async function GET(req: Request) {
  if (!isSyncAuthorized(req)) {
    return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('test_food_records')
    .select('submitted_at, tanggal, waktu, mod, pic, counter, nama_produk, nilai, komentar')
    .order('tanggal', { ascending: true });

  if (error) {
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

    await ensureSheetExists(sheets, spreadsheetId, SHEET_NAME);

    const header = ['Timestamp', 'Tanggal', 'Shift', 'MOD', 'PIC', 'Counter', 'Nama Produk', 'Nilai', 'Komentar'];
    const rows = (data || []).map((r: any) => [
      r.submitted_at, r.tanggal, r.waktu, r.mod, r.pic, r.counter, r.nama_produk, r.nilai, r.komentar,
    ]);

    // Bersihkan isi lama, tulis ulang semua data (mirror penuh, sederhana dan pasti konsisten)
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:Z100000`,
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header, ...rows] },
    });

    return Response.json({ success: true, rows: rows.length });
  } catch (e: any) {
    return Response.json({ success: false, message: e.toString() }, { status: 500 });
  }
}

async function ensureSheetExists(sheets: any, spreadsheetId: string, sheetName: string) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some((s: any) => s.properties.title === sheetName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
  }
}
