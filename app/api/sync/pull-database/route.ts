import { getSupabase } from '@/lib/supabase';
import { getSheetsClient } from '@/lib/googleSheets';
import { isSyncAuthorized } from '@/lib/syncAuth';
import { normalizeSheetDate } from '@/lib/sheetDate';

export const maxDuration = 60;

const WATERMARK_KEY = 'pull_database_last_ts';
const BATCH_SIZE = 20; // jumlah kelompok (tanggal+shift) yang diproses paralel sekaligus

function findColumn(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = header.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
}

// Sync ini mendukung 2 mode:
// - Incremental (default): hanya memproses baris di sheet yang Timestamp-nya lebih baru
//   dari sync terakhir (dilacak lewat tabel sync_state). Jauh lebih cepat untuk run berikutnya.
// - Full (?full=1): abaikan penanda, proses ulang SEMUA baris dari awal.
export async function GET(req: Request) {
  if (!isSyncAuthorized(req)) {
    return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const forceFull = url.searchParams.get('full') === '1';

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
    const supabase = getSupabase();

    // UNFORMATTED_VALUE + SERIAL_NUMBER: semua sel tanggal/angka dikembalikan sebagai
    // angka serial mentah, bukan teks berformat lokal - jadi lebih konsisten diparse.
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Database!A1:I',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });

    const allRows = res.data.values || [];
    if (allRows.length < 2) {
      return Response.json({ success: true, rows: 0, message: 'Sheet Database kosong.' });
    }

    const header = allRows[0].map((h: any) => String(h).trim().toLowerCase());
    const idx = {
      timestamp: findColumn(header, ['timestamp']),
      tanggal: findColumn(header, ['tanggal']),
      waktu: findColumn(header, ['shift', 'waktu']),
      mod: findColumn(header, ['mod']),
      pic: findColumn(header, ['pic']),
      counter: findColumn(header, ['counter']),
      nama_produk: findColumn(header, ['nama produk', 'nama_produk', 'produk']),
      nilai: findColumn(header, ['nilai', 'skor']),
      komentar: findColumn(header, ['komentar', 'comment']),
    };

    if (idx.tanggal === -1 || idx.waktu === -1) {
      return Response.json({
        success: false,
        message: `Kolom 'Tanggal' atau 'Shift' tidak ditemukan. Header terbaca: [${header.join(', ')}]`,
      }, { status: 400 });
    }

    // Ambil penanda sync terakhir (kalau ada dan bukan mode full)
    let watermark = 0;
    if (!forceFull && idx.timestamp !== -1) {
      const { data: state } = await supabase
        .from('sync_state')
        .select('value')
        .eq('key', WATERMARK_KEY)
        .maybeSingle();
      if (state?.value) watermark = parseFloat(state.value) || 0;
    }

    let dataRows = allRows.slice(1);
    if (idx.timestamp !== -1 && watermark > 0) {
      dataRows = dataRows.filter((r) => (parseFloat(r[idx.timestamp]) || 0) > watermark);
    }

    let maxTsSeen = watermark;
    const records = dataRows
      .map((r) => {
        const tanggal = normalizeSheetDate(r[idx.tanggal]);
        const waktu = String(r[idx.waktu] || '').trim().toUpperCase();
        if (idx.timestamp !== -1) {
          const ts = parseFloat(r[idx.timestamp]) || 0;
          if (ts > maxTsSeen) maxTsSeen = ts;
        }
        return {
          tanggal,
          waktu,
          mod: idx.mod !== -1 ? (r[idx.mod] || null) : null,
          pic: idx.pic !== -1 ? (r[idx.pic] || null) : null,
          counter: idx.counter !== -1 ? (r[idx.counter] || null) : null,
          nama_produk: idx.nama_produk !== -1 ? (r[idx.nama_produk] || null) : null,
          nilai: idx.nilai !== -1 && r[idx.nilai] !== '' && r[idx.nilai] !== undefined ? Number(r[idx.nilai]) : null,
          komentar: idx.komentar !== -1 ? (r[idx.komentar] || null) : null,
        };
      })
      .filter((r) => r.tanggal && r.waktu);

    if (records.length === 0) {
      return Response.json({
        success: true,
        rows: 0,
        groups: 0,
        mode: watermark > 0 ? 'incremental' : 'full',
        message: 'Tidak ada baris baru sejak sync terakhir.',
      });
    }

    // Kelompokkan per (tanggal, waktu)
    const groups = new Map<string, any[]>();
    for (const rec of records) {
      const key = `${rec.tanggal}|${rec.waktu}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rec);
    }
    const groupEntries = Array.from(groups.entries());

    let totalInserted = 0;
    const errors: string[] = [];

    // Proses per-batch (BATCH_SIZE kelompok sekaligus, paralel), bukan satu-satu berurutan
    for (let i = 0; i < groupEntries.length; i += BATCH_SIZE) {
      const batch = groupEntries.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async ([key, items]) => {
          const [tanggal, waktu] = key.split('|');
          try {
            await supabase.from('test_food_records').delete().eq('tanggal', tanggal).eq('waktu', waktu);
            const { error } = await supabase.from('test_food_records').insert(items);
            if (error) throw new Error(error.message);
            totalInserted += items.length;
          } catch (e: any) {
            errors.push(`${key}: ${e.toString()}`);
          }
        })
      );
    }

    // Simpan penanda baru, supaya sync berikutnya cuma proses baris yang benar-benar baru
    if (idx.timestamp !== -1 && maxTsSeen > watermark) {
      await supabase.from('sync_state').upsert(
        { key: WATERMARK_KEY, value: String(maxTsSeen), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    }

    return Response.json({
      success: true,
      groups: groupEntries.length,
      rows: totalInserted,
      mode: watermark > 0 ? 'incremental' : 'full',
      errors,
    });
  } catch (e: any) {
    return Response.json({ success: false, message: e.toString() }, { status: 500 });
  }
}
