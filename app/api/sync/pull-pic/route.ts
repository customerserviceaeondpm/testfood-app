import { getSupabase } from '@/lib/supabase';
import { getSheetsClient } from '@/lib/googleSheets';
import { isSyncAuthorized } from '@/lib/syncAuth';
import { normalizeSheetDate } from '@/lib/sheetDate';

// Beri waktu eksekusi lebih panjang (Vercel akan tetap membatasi sesuai paket kamu,
// tapi ini menaikkan batas maksimum yang diminta function-nya).
export const maxDuration = 60;

// Membaca kolom berdasarkan NAMA header di baris pertama sheet Master_PIC.
// Semua baris diproses PARALEL lalu dikirim ke Supabase dalam SATU kali panggilan
// (bukan satu-satu), supaya tidak lewat batas waktu eksekusi function di Vercel.
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

    // Siapkan semua baris secara PARALEL (Promise.all), termasuk upload tanda tangan
    // base64 kalau ada. Baris tanpa tanggal/waktu dilewati (null).
    const prepared = await Promise.all(
      dataRows.map(async (r) => {
        const tanggal = normalizeSheetDate(r[idx.tanggal]);
        const waktu = String(r[idx.waktu] || '').trim().toUpperCase();
        if (!tanggal || !waktu) return null;

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

        return {
          tanggal,
          waktu,
          nama_pic: namaPic,
          signature_url: signatureUrl,
          items,
          updated_at: new Date().toISOString(),
        };
      })
    );

    const records = prepared.filter((r): r is NonNullable<typeof r> => r !== null);

    if (records.length === 0) {
      return Response.json({ success: true, rows: 0, totalRowsInSheet: dataRows.length });
    }

    // SATU kali panggilan upsert untuk semua baris, bukan loop satu-satu
    const { error } = await supabase
      .from('pic_submissions')
      .upsert(records, { onConflict: 'tanggal,waktu' });

    if (error) {
      return Response.json({ success: false, message: error.message }, { status: 500 });
    }

    return Response.json({
      success: true,
      rows: records.length,
      totalRowsInSheet: dataRows.length,
    });
  } catch (e: any) {
    return Response.json({ success: false, message: e.toString() }, { status: 500 });
  }
}
