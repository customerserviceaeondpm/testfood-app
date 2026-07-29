import { getSupabase } from '@/lib/supabase';
import { generateReport } from '@/lib/report';

// Proses generate PDF lewat template Google Sheets butuh waktu lebih lama
// (salin sheet, isi data, tunggu gambar tanda tangan render, export, upload ke Drive).
export const maxDuration = 60;

export async function POST(req: Request) {
  const data = await req.json();
  const supabase = getSupabase();

  // Ambil nama PIC & tanda tangan PIC untuk tanggal & shift ini (sama seperti getPicData() lama)
  const { data: pic } = await supabase
    .from('pic_submissions')
    .select('nama_pic, signature_url')
    .eq('tanggal', data.tanggal)
    .eq('waktu', data.waktu)
    .maybeSingle();

  if (!pic) {
    return Response.json({
      success: false,
      message: `Data belum diinput PIC untuk tanggal ${data.tanggal} shift ${data.waktu}`,
    });
  }

  // Hapus record lama tanggal+shift yang sama, lalu insert baru (proteksi double input, sama seperti lama)
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

  try {
    const url = await generateReport(data, pic.nama_pic, pic.signature_url || null, supabase);
    return Response.json({ success: true, url });
  } catch (e: any) {
    // Ambil pesan detail dari Google API kalau ada (lebih spesifik dari e.toString())
    const detail = e?.response?.data?.error?.message || e?.errors?.[0]?.message || e?.message || e.toString();
    // Data sudah tersimpan walau proses generate laporan gagal
    return Response.json({
      success: true,
      url: null,
      message: 'Data tersimpan, tapi laporan gagal dibuat: ' + detail,
    });
  }
}
