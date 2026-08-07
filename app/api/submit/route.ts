import { getSupabase } from '@/lib/supabase';
import { generateReport } from '@/lib/report';

export const maxDuration = 60;

export async function POST(req: Request) {
  const data = await req.json();
  const supabase = getSupabase();

  // Ambil nama PIC, tanda tangan PIC, dan daftar item PIC untuk tanggal & shift ini
  const { data: pic } = await supabase
    .from('pic_submissions')
    .select('nama_pic, signature_url, items')
    .eq('tanggal', data.tanggal)
    .eq('waktu', data.waktu)
    .maybeSingle();

  if (!pic) {
    return Response.json({
      success: false,
      message: `Data belum diinput PIC untuk tanggal ${data.tanggal} shift ${data.waktu}`,
    });
  }

  // Hapus record lama tanggal+shift yang sama, lalu insert baru (proteksi double input)
  await supabase.from('test_food_records').delete().eq('tanggal', data.tanggal).eq('waktu', data.waktu);

  const rows = (data.items || []).map((item: any) => ({
    tanggal: data.tanggal,
    waktu: data.waktu,
    mod: data.mod,
    pic: pic.nama_pic,
    counter: item.counter,
    nama_produk: item.nama,
    nilai: item.nilai,
    komentar: item.comment,
  }));

  const { error } = await supabase.from('test_food_records').insert(rows);
  if (error) return Response.json({ success: false, message: error.message });

  // Item yang ditambahkan MANUAL oleh tester (biasanya dari departemen Bakery/Produce
  // yang tidak selalu diinput PIC) disimpan balik ke pic_submissions.items, supaya
  // ke depannya PIC/tester tidak perlu input manual lagi untuk menu yang sama.
  try {
    const manualItems = (data.items || []).filter((item: any) => item.source === 'MANUAL');
    if (manualItems.length > 0) {
      const existingItems: any[] = Array.isArray(pic.items) ? pic.items : [];
      const keyOf = (c: string, n: string) => `${String(c || '').trim().toUpperCase()}|${String(n || '').trim().toLowerCase()}`;
      const existingKeys = new Set(existingItems.map((it: any) => keyOf(it.counter, it.nama)));

      const newEntries = manualItems
        .filter((item: any) => !existingKeys.has(keyOf(item.counter, item.nama)))
        .map((item: any) => ({ counter: item.counter, nama: item.nama }));

      if (newEntries.length > 0) {
        const mergedItems = [...existingItems, ...newEntries];
        await supabase
          .from('pic_submissions')
          .update({ items: mergedItems, updated_at: new Date().toISOString() })
          .eq('tanggal', data.tanggal)
          .eq('waktu', data.waktu);
      }
    }
  } catch (mergeErr) {
    console.error('Gagal merge item manual ke pic_submissions:', mergeErr);
    // Tidak fatal - data test_food_records tetap tersimpan walau merge ini gagal
  }

  try {
    const result = await generateReport(data, pic.nama_pic, pic.signature_url || null, supabase);
    return Response.json({
      success: true,
      url: result.url,
      message: result.warnings.length > 0 ? result.warnings.join(' | ') : undefined,
    });
  } catch (e: any) {
    const detail = e?.response?.data?.error?.message || e?.errors?.[0]?.message || e?.message || e.toString();
    return Response.json({
      success: true,
      url: null,
      message: 'Data tersimpan, tapi laporan gagal dibuat: ' + detail,
    });
  }
}
