import { getSupabase } from '@/lib/supabase';
import { DIVISI_ORDER } from '@/lib/divisi';

function normalizeDivisi(v: any): string | null {
  const d = String(v || '').trim().toUpperCase();
  return (DIVISI_ORDER as readonly string[]).includes(d) ? d : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tanggal = searchParams.get('tanggal');
  const waktu = searchParams.get('waktu');
  const divisiParam = searchParams.get('divisi');
  if (!tanggal || !waktu) {
    return Response.json({ success: false, message: 'tanggal dan waktu wajib diisi' }, { status: 400 });
  }

  const supabase = getSupabase();
  let query = supabase
    .from('pic_submissions')
    .select('*')
    .eq('tanggal', tanggal)
    .eq('waktu', waktu);

  const divisi = divisiParam ? normalizeDivisi(divisiParam) : null;
  if (divisi) query = query.eq('divisi', divisi);

  const { data, error } = await query;
  if (error) return Response.json({ success: false, message: error.message }, { status: 500 });

  const rows = data || [];
  if (divisi) {
    const row = rows[0];
    if (!row) {
      return Response.json({ success: false, message: `Divisi ${divisi} belum input untuk tanggal ${tanggal} shift ${waktu}` });
    }
    return Response.json({
      success: true,
      divisi: row.divisi,
      namaPic: row.nama_pic,
      sigPic: row.signature_url,
      items: row.items || [],
    });
  }

  if (rows.length === 0) {
    return Response.json({ success: false, message: `Data belum diinput PIC untuk tanggal ${tanggal} shift ${waktu}` });
  }

  const byDivisi: Record<string, any> = {};
  const items: any[] = [];
  const signatures: { divisi: string; url: string | null }[] = [];
  const names: { divisi: string; nama: string }[] = [];
  for (const r of rows) {
    const d = String(r.divisi || 'DELICA').toUpperCase();
    byDivisi[d] = { namaPic: r.nama_pic, items: r.items || [] };
    items.push(...(Array.isArray(r.items) ? r.items : []));
    signatures.push({ divisi: d, url: r.signature_url || null });
    if (r.nama_pic) names.push({ divisi: d, nama: r.nama_pic });
  }

  return Response.json({
    success: true,
    byDivisi,
    divisiMasuk: Object.keys(byDivisi).sort(
      (a, b) => DIVISI_ORDER.indexOf(a as any) - DIVISI_ORDER.indexOf(b as any)
    ),
    namaPic: names.map((n) => n.nama).join(' / '),
    names,
    sigPic: rows[0]?.signature_url || null,
    signatures,
    items,
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = getSupabase();

  const divisi = normalizeDivisi(body.divisi) || 'DELICA';

  let signatureUrl = body.sigData;
  if (body.sigData && body.sigData.startsWith('data:image')) {
    const base64 = body.sigData.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const fileName = `pic_${divisi.toLowerCase()}_${body.tanggal}_${body.waktu}_${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from('signatures')
      .upload(fileName, buffer, { contentType: 'image/png', upsert: true });
    if (!uploadError) {
      const { data: pub } = supabase.storage.from('signatures').getPublicUrl(fileName);
      signatureUrl = pub.publicUrl;
    }
  }

  const { error } = await supabase.from('pic_submissions').upsert(
    {
      tanggal: body.tanggal,
      waktu: body.waktu,
      divisi,
      nama_pic: body.nama,
      signature_url: signatureUrl,
      items: body.items || [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tanggal,waktu,divisi' }
  );

  if (error) return Response.json('❌ Error Server: ' + error.message);
  return Response.json('✅ Data PIC Berhasil Disimpan!');
}
