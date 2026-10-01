import { getSupabase } from '@/lib/supabase';

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = getSupabase();

  if (!body.sigData || !body.sigData.startsWith('data:image')) {
    return Response.json({ success: false, message: 'Invalid signature data' }, { status: 400 });
  }

  const base64 = body.sigData.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');
  const fileName = `${body.type.toLowerCase()}_${body.tanggal}_${body.waktu}_${Date.now()}.png`;

  const { error } = await supabase.storage
    .from('signatures')
    .upload(fileName, buffer, { contentType: 'image/png', upsert: true });

  if (error) {
    return Response.json({ success: false, message: error.message }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from('signatures').getPublicUrl(fileName);

  return Response.json({ success: true, url: pub.publicUrl });
}
