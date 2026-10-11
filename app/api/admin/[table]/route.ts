import { getSupabase } from '@/lib/supabase';
import { verifyAdminToken } from '@/lib/adminAuth';

const ALLOWED_TABLES = [
  'pic_submissions',
  'test_food_records',
  'tester_drafts',
  'generated_reports',
];

export async function GET(req: Request, { params }: { params: { table: string } }) {
  if (!verifyAdminToken(req)) {
    return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const table = params.table;
  if (!ALLOWED_TABLES.includes(table)) {
    return Response.json({ success: false, message: 'Table not allowed' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const tanggal = searchParams.get('tanggal');
  const waktu = searchParams.get('waktu');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const supabase = getSupabase();
  let query = supabase.from(table).select('*', { count: 'exact' });

  if (tanggal) query = query.eq('tanggal', tanggal);
  if (waktu) query = query.eq('waktu', waktu);

  if (table === 'test_food_records') query = query.order('id', { ascending: false });
  else if (table === 'pic_submissions') query = query.order('tanggal', { ascending: false });
  else if (table === 'tester_drafts') query = query.order('tanggal', { ascending: false });
  else if (table === 'generated_reports') query = query.order('id', { ascending: false });

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return Response.json({ success: false, message: error.message }, { status: 500 });

  return Response.json({ success: true, data, count });
}

export async function DELETE(req: Request, { params }: { params: { table: string } }) {
  if (!verifyAdminToken(req)) {
    return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const table = params.table;
  if (!ALLOWED_TABLES.includes(table)) {
    return Response.json({ success: false, message: 'Table not allowed' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const tanggal = searchParams.get('tanggal');
  const waktu = searchParams.get('waktu');

  const supabase = getSupabase();

  if (id) {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return Response.json({ success: false, message: error.message }, { status: 500 });
    return Response.json({ success: true });
  }

  if (table === 'test_food_records' && tanggal && waktu) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('tanggal', tanggal)
      .eq('waktu', waktu);
    if (error) return Response.json({ success: false, message: error.message }, { status: 500 });
    return Response.json({ success: true });
  }

  return Response.json({ success: false, message: 'Invalid delete params' }, { status: 400 });
}
