import { getSupabase } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tanggal = searchParams.get('tanggal');
  const waktu = searchParams.get('waktu');
  if (!tanggal || !waktu) {
    return Response.json({ success: false, message: 'tanggal dan waktu wajib diisi' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pic_submissions')
    .select('*')
    .eq('tanggal', tanggal)
    .eq('waktu', waktu)
    .maybeSingle();

  if (error) return Response.json({ success: false, message: error.message }, { status: 500 });
  if (!data) {
    return Response.json({ success: false, message: `Data belum diinput PIC untuk tanggal ${tanggal} shift ${waktu}` });
  }

  return Response.json({
    success: true,
    namaPic: data.nama_pic,
    sigPic: data.signature_url,
    items: data.items || [],
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = getSupabase();

  // Upload tanda tangan (base64) ke Supabase Storage, gantinya insertSignatureFixed lama
  let signatureUrl = body.sigData;
  if (body.sigData && body.sigData.startsWith('data:image')) {
    const base64 = body.sigData.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const fileName = `pic_${body.tanggal}_${body.waktu}_${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from('signatures')
      .upload(fileName, buffer, { contentType: 'image/png', upsert: true });
    if (!uploadError) {
      const { data: pub } = supabase.storage.from('signatures').getPublicUrl(fileName);
      signatureUrl = pub.publicUrl;
    }
  }

  // Upsert berdasarkan (tanggal, waktu) - sama seperti logika cari-lalu-update di savePicData lama
  const { error } = await supabase.from('pic_submissions').upsert(
    {
      tanggal: body.tanggal,
      waktu: body.waktu,
      nama_pic: body.nama,
      signature_url: signatureUrl,
      items: body.items || [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tanggal,waktu' }
  );

  if (error) return Response.json('❌ Error Server: ' + error.message);
  return Response.json('✅ Data PIC Berhasil Disimpan!');
}
