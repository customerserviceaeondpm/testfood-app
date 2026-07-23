import { getSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tanggal = searchParams.get('tanggal');
  const waktu = searchParams.get('waktu');

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tester_drafts')
    .select('*')
    .eq('tanggal', tanggal)
    .eq('waktu', waktu)
    .maybeSingle();

  if (error || !data) return Response.json({ success: false });
  return Response.json({ success: true, data: data.data });
}

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = getSupabase();

  const { error } = await supabase.from('tester_drafts').upsert(
    {
      tanggal: body.tanggal,
      waktu: body.waktu,
      mod: body.mod,
      data: body,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tanggal,waktu' }
  );

  if (error) return Response.json('❌ Error: ' + error.message);
  return Response.json('✅ Draft Tester Berhasil Disimpan!');
}
