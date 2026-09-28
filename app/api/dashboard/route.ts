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

  const { data, error } = await supabase
    .from('test_food_records')
    .select('tanggal, waktu, nilai')
    .gte('tanggal', from)
    .lte('tanggal', to)
    .limit(10000);

  if (error) {
    console.error('[dashboard] Supabase error:', error);
    return Response.json({ calendar: {} });
  }

  console.log(`[dashboard] fetched ${data?.length || 0} rows`);
  console.log('[dashboard] sample rows:', data?.slice(0, 3));

  const calendar: Record<number, { pagi: boolean; sore: boolean; hasIssue: boolean }> = {};
  for (const row of data) {
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
