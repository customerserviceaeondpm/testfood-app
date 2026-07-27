import { getSupabase } from '@/lib/supabase';
import { getSheetsClient } from '@/lib/googleSheets';
import { isSyncAuthorized } from '@/lib/syncAuth';
import { normalizeSheetDate } from '@/lib/sheetDate';

// Kolom sheet "Master_PIC": Timestamp, Tanggal, Waktu, Nama PIC, TTD Data, JSON_Items
export async function GET(req: Request) {
  if (!isSyncAuthorized(req)) {
    return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Master_PIC!A2:F',
    });

    const rows = res.data.values || [];
    const supabase = getSupabase();
    let count = 0;
    const errors: string[] = [];

    for (const r of rows) {
      const tanggal = normalizeSheetDate(r[1]);
      const waktu = String(r[2] || '').trim().toUpperCase();
      if (!tanggal || !waktu) continue;

      const namaPic = r[3] || null;
      const ttdRaw = r[4] || null;

      let items: any[] = [];
      try {
        items = r[5] ? JSON.parse(r[5]) : [];
      } catch {
        items = [];
      }

      // Kalau TTD masih berupa base64 mentah, upload ke Storage supaya konsisten
      // dengan cara penyimpanan tanda tangan lewat form PIC baru.
      let signatureUrl = ttdRaw;
      if (ttdRaw && typeof ttdRaw === 'string' && ttdRaw.startsWith('data:image')) {
        const base64 = ttdRaw.split(',')[1];
        const buffer = Buffer.from(base64, 'base64');
        const fileName = `pic_${tanggal}_${waktu}_${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage
          .from('signatures')
          .upload(fileName, buffer, { contentType: 'image/png', upsert: true });
        if (!uploadError) {
          const { data: pub } = supabase.storage.from('signatures').getPublicUrl(fileName);
          signatureUrl = pub.publicUrl;
        }
      }

      const { error } = await supabase.from('pic_submissions').upsert(
        {
          tanggal,
          waktu,
          nama_pic: namaPic,
          signature_url: signatureUrl,
          items,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tanggal,waktu' }
      );

      if (error) {
        errors.push(`${tanggal} ${waktu}: ${error.message}`);
        continue;
      }
      count++;
    }

    return Response.json({ success: true, rows: count, errors });
  } catch (e: any) {
    return Response.json({ success: false, message: e.toString() }, { status: 500 });
  }
}
