import { getSupabase } from '@/lib/supabase';
import { getSheetsClient } from '@/lib/googleSheets';
import { isSyncAuthorized } from '@/lib/syncAuth';

export async function GET(req: Request) {
  if (!isSyncAuthorized(req)) {
    return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

    // Sesuaikan range ini kalau struktur kolom Master_Produk kamu beda
    // (kolom A = counter, kolom B = nama produk, mulai baris 2 karena baris 1 header)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Master_Produk!A2:B',
    });

    const rows = res.data.values || [];
    console.log('[pull-products] Sheet rows read:', rows.length);

    // Guard: kalau sheet kosong / range salah (baca 0 baris valid), JANGAN hapus data existing
    if (rows.length === 0) {
      return Response.json({
        success: false,
        message: 'Sheet Master_Produk kosong atau range salah. Data existing tidak dihapus.',
        rows: 0
      }, { status: 400 });
    }

    const items = rows
      .filter((r: any[]) => r[0] && r[1])
      .map((r: any[]) => ({ counter: String(r[0]).trim(), product_name: String(r[1]).trim() }));

    console.log('[pull-products] Valid items to insert:', items.length);

    if (items.length === 0) {
      return Response.json({
        success: false,
        message: 'Tidak ada item valid di sheet (cek kolom A & B). Data existing tidak dihapus.',
        rows: 0
      }, { status: 400 });
    }

    const supabase = getSupabase();

    // Mirror penuh dari Sheets: hapus semua data lama, insert ulang
    await supabase.from('products').delete().neq('id', 0);

    const { error } = await supabase.from('products').insert(items);
    if (error) {
      return Response.json({ success: false, message: error.message }, { status: 500 });
    }

    return Response.json({ success: true, rows: items.length });
  } catch (e: any) {
    return Response.json({ success: false, message: e.toString() }, { status: 500 });
  }
}
