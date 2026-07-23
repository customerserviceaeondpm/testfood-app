import { getSupabase } from '@/lib/supabase';

export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('products').select('counter, product_name');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const map: Record<string, string[]> = {};
  for (const row of data) {
    if (!map[row.counter]) map[row.counter] = [];
    map[row.counter].push(row.product_name);
  }
  return Response.json(map);
}
