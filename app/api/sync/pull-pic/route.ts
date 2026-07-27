import { getSupabase } from '@/lib/supabase';
import { getSheetsClient } from '@/lib/googleSheets';
import { isSyncAuthorized } from '@/lib/syncAuth';
import { normalizeSheetDate } from '@/lib/sheetDate';

// Membaca kolom berdasarkan NAMA header di baris pertama sheet Master_PIC,
// bukan posisi tetap - jadi tetap jalan walau urutan/nama kolom berubah,
// selama nama headernya konsisten dengan yang dicari di bawah.
export async function GET(req: Request) {
  if (!isSyncAuthorized(req)) {
    return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Master_PIC!A1:Z',
    });

    const allRows = res.data.values || [];
    if (allRows.length < 2) {
      return Response.json({
        success: true,
        rows: 0,
        message: 'Sheet Master_PIC kosong atau cuma ada baris header.',
      });
    }

    const header = allRows[0].map((h: any) => String(h).trim().toLowerCase());
    const idx = {
      tanggal: header.indexOf('tanggal'),
      waktu: header.indexOf('waktu'),
      nama_pic: header.indexOf('nama_pic'),
      signature_url: header.indexOf('signature_url'),
      items: header.indexOf('items'),
    };

    if (idx.tanggal === -1 || idx.waktu === -1) {
      return Response.json({
        success: false,
        message: `Kolom 'tanggal' atau 'waktu' tidak ditemukan. Header yang terbaca di sheet: [${header.join(', ')}]`,
      }, { status: 400 });
    }

    const dataRows = allRows.slice(1);
    const supabase = getSupabase();
    let count = 0;
    const errors: string[] = [];

    for (const r of dataRows) {
      const tanggal = normalizeSheetDate(r[idx.tanggal]);
      const waktu = String(r[idx.waktu] || '').trim().toUpperCase();
      if (!tanggal || !waktu) continue;

      const namaPic = idx.nama_pic !== -1 ? (r[idx.nama_pic] || null) : null;
      const ttdRaw = idx.signature_url !== -1 ? (r[idx.signature_url] || null) : null;

      let items: any[] = [];
      const itemsRaw = idx.items !== -1 ? r[idx.items] : null;
      if (itemsRaw) {
        try {
          items = JSON.parse(itemsRaw);
        } catch {
          items = [];
        }
      }

      // Kalau signature_url ternyata masih base64 mentah (bukan URL), upload dulu ke Storage
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

    return Response.json({
      success: true,
      rows: count,
      totalRowsInSheet: dataRows.length,
      errors,
    });
  } catch (e: any) {
    return Response.json({ success: false, message: e.toString() }, { status: 500 });
  }
}
