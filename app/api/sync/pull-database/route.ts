import { getSupabase } from '@/lib/supabase';
import { getSheetsClient } from '@/lib/googleSheets';
import { isSyncAuthorized } from '@/lib/syncAuth';
import { normalizeSheetDate } from '@/lib/sheetDate';

// Kolom sheet "Database": Timestamp, Tanggal, Shift, MOD, PIC, Counter, Nama Produk, Nilai, Komentar
export async function GET(req: Request) {
  if (!isSyncAuthorized(req)) {
    return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Database!A2:I', // lewati baris header di baris 1
    });

    const rows = res.data.values || [];
    const records = rows
      .filter((r: any[]) => r[1] && r[2]) // minimal tanggal & shift harus ada
      .map((r: any[]) => ({
        tanggal: normalizeSheetDate(r[1]),
        waktu: String(r[2] || '').trim().toUpperCase(),
        mod: r[3] || null,
        pic: r[4] || null,
        counter: r[5] || null,
        nama_produk: r[6] || null,
        nilai: r[7] !== undefined && r[7] !== '' ? parseInt(r[7], 10) : null,
        komentar: r[8] || null,
      }))
      .filter((r: any) => r.tanggal && r.waktu);

    const supabase = getSupabase();

    // Kelompokkan per (tanggal, waktu). Untuk tiap kelompok: hapus data lama di Supabase
    // untuk tanggal+shift itu, lalu insert ulang dari sheet. Ini supaya tanggal lain yang
    // TIDAK ada di sheet tetap aman, tidak ikut terhapus.
    const groups = new Map<string, any[]>();
    for (const rec of records) {
      const key = `${rec.tanggal}|${rec.waktu}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rec);
    }

    let totalInserted = 0;
    for (const [key, items] of groups) {
      const [tanggal, waktu] = key.split('|');
      await supabase.from('test_food_records').delete().eq('tanggal', tanggal).eq('waktu', waktu);
      const { error } = await supabase.from('test_food_records').insert(items);
      if (error) throw new Error(`${key}: ${error.message}`);
      totalInserted += items.length;
    }

    return Response.json({ success: true, groups: groups.size, rows: totalInserted });
  } catch (e: any) {
    return Response.json({ success: false, message: e.toString() }, { status: 500 });
  }
}
