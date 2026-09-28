import { getSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bulan = parseInt(searchParams.get('bulan') || '0');
  const tahun = parseInt(searchParams.get('tahun') || '0');

  const supabase = getSupabase();
  const from = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
  const lastDay = new Date(tahun, bulan, 0).getDate();
  const to = `${tahun}-${String(bulan).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  console.log(`[dashboard] bulan=${bulan}, tahun=${tahun}, from=${from}, to=${to}`);

  let allData: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('test_food_records')
      .select('tanggal, waktu, nilai')
      .gte('tanggal', from)
      .lte('tanggal', to)
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error('[dashboard] Supabase error:', error);
      return Response.json({ calendar: {} });
    }

    if (!data || data.length === 0) break;

    allData = [...allData, ...data];
    console.log(`[dashboard] page ${page}: fetched ${data.length} rows`);

    if (data.length < pageSize) break;
    page++;
  }

  console.log(`[dashboard] total fetched ${allData.length} rows`);
  console.log('[dashboard] sample rows:', allData.slice(0, 3));

  const calendar: Record<number, { pagi: boolean; sore: boolean; hasIssue: boolean }> = {};
  for (const row of allData) {
    const tanggalStr = String(row.tanggal);
    const d = parseInt(tanggalStr.slice(0, 10).split('-')[2], 10);
    if (!calendar[d]) calendar[d] = { pagi: false, sore: false, hasIssue: false };
    const waktuUpper = (row.waktu || '').toString().toUpperCase().trim();
    if (waktuUpper === 'PAGI') calendar[d].pagi = true;
    if (waktuUpper === 'SORE') calendar[d].sore = true;
    if (row.nilai != null && row.nilai < 3) calendar[d].hasIssue = true;
  }

  console.log(`[dashboard] calendar keys: [${Object.keys(calendar).sort((a,b)=>+a - +b).join(', ')}]`);
  return Response.json({ calendar });
}
