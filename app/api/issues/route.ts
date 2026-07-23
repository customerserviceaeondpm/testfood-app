import { getSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bulan = parseInt(searchParams.get('bulan') || '0');
  const tahun = parseInt(searchParams.get('tahun') || '0');

  const supabase = getSupabase();
  const from = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
  const to = `${tahun}-${String(bulan).padStart(2, '0')}-31`;

  const { data, error } = await supabase
    .from('test_food_records')
    .select('tanggal, waktu, counter, nama_produk, nilai, komentar')
    .gte('tanggal', from)
    .lte('tanggal', to);

  if (error) return Response.json([]);

  const issues = data
    .filter((r: any) => (r.nilai != null && r.nilai < 3) || r.komentar)
    .map((r: any) => ({
      tgl: parseInt(r.tanggal.split('-')[2]),
      shift: r.waktu,
      counter: r.counter,
      produk: r.nama_produk,
      nilai: r.nilai,
      comment: r.komentar,
    }))
    .sort((a: any, b: any) => b.tgl - a.tgl);

  return Response.json(issues);
}
