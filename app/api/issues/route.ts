import { getSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bulan = parseInt(searchParams.get('bulan') || '0');
  const tahun = parseInt(searchParams.get('tahun') || '0');

  const supabase = getSupabase();
  const from = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
  const lastDay = new Date(tahun, bulan, 0).getDate();
  const to = `${tahun}-${String(bulan).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  console.log(`[issues] bulan=${bulan}, tahun=${tahun}, from=${from}, to=${to}`);

  let allData: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('test_food_records')
      .select('tanggal, waktu, counter, nama_produk, nilai, komentar')
      .gte('tanggal', from)
      .lte('tanggal', to)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('[issues] Supabase error:', error);
      return Response.json([]);
    }

    if (!data || data.length === 0) break;

    allData = [...allData, ...data];
    console.log(`[issues] page ${page}: fetched ${data.length} rows`);

    if (data.length < pageSize) break;
    page++;
  }

  console.log(`[issues] total fetched ${allData.length} rows`);

  const issues = allData
    .filter((r: any) => (r.nilai != null && r.nilai < 3) || r.komentar)
    .map((r: any) => ({
      tgl: parseInt(String(r.tanggal).slice(0, 10).split('-')[2], 10),
      shift: r.waktu,
      counter: r.counter,
      produk: r.nama_produk,
      nilai: r.nilai,
      comment: r.komentar,
    }))
    .sort((a: any, b: any) => b.tgl - a.tgl);

  console.log(`[issues] filtered to ${issues.length} issues`);
  return Response.json(issues);
}
