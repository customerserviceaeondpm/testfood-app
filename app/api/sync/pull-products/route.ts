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
    const items = rows
      .filter((r: any[]) => r[0] && r[1])
      .map((r: any[]) => ({ counter: String(r[0]).trim(), product_name: String(r[1]).trim() }));

    const supabase = getSupabase();

    // Mirror penuh dari Sheets: hapus semua data lama, insert ulang
    await supabase.from('products').delete().neq('id', 0);

    if (items.length > 0) {
      const { error } = await supabase.from('products').insert(items);
      if (error) {
        return Response.json({ success: false, message: error.message }, { status: 500 });
      }
    }

    return Response.json({ success: true, rows: items.length });
  } catch (e: any) {
    return Response.json({ success: false, message: e.toString() }, { status: 500 });
  }
}
