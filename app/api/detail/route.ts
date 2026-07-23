import { getSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tanggal = searchParams.get('tanggal');

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('test_food_records')
    .select('waktu, mod, pic, counter, nama_produk, nilai, komentar')
    .eq('tanggal', tanggal);

  if (error) return Response.json([]);

  return Response.json(
    data.map((r: any) => ({
      shift: r.waktu,
      mod: r.mod,
      pic: r.pic,
      counter: r.counter,
      produk: r.nama_produk,
      nilai: r.nilai,
      comment: r.komentar,
    }))
  );
}
