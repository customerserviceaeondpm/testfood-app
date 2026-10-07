import { getSupabase } from '@/lib/supabase';
import { generateReport } from '@/lib/report';
import { counterToDivisi, sortNamesByDivisi, DIVISI_ORDER } from '@/lib/divisi';
import { compositeSignaturesHorizontal } from '@/lib/signatureComposite';

export const maxDuration = 60;

export async function POST(req: Request) {
  const data = await req.json();
  const supabase = getSupabase();

  // Ambil semua baris PIC per divisi untuk tanggal & shift ini
  const { data: picRows } = await supabase
    .from('pic_submissions')
    .select('divisi, nama_pic, signature_url, items')
    .eq('tanggal', data.tanggal)
    .eq('waktu', data.waktu);

  const rows = picRows || [];
  const delicaRow = rows.find((r: any) => String(r.divisi || 'DELICA').toUpperCase() === 'DELICA');

  if (!delicaRow) {
    return Response.json({
      success: false,
      message: `Data belum diinput PIC Delica/Sushi untuk tanggal ${data.tanggal} shift ${data.waktu}`,
    });
  }

  const picNames = sortNamesByDivisi(
    rows.map((r: any) => ({ divisi: String(r.divisi || 'DELICA'), nama: r.nama_pic || '' }))
  );

  const missingComments = (data.items || []).filter(
    (item: any) => Number(item.nilai) < 3 && !String(item.comment || '').trim()
  );
  if (missingComments.length > 0) {
    return Response.json({
      success: false,
      message: `Produk dengan nilai kurang dari 3 wajib diisi komentar: ${missingComments
        .map((it: any) => `[${it.counter}] ${it.nama} (Nilai ${it.nilai})`)
        .join(', ')}`,
    });
  }

  // Hapus record lama tanggal+shift yang sama, lalu insert baru (proteksi double input)
  await supabase.from('test_food_records').delete().eq('tanggal', data.tanggal).eq('waktu', data.waktu);

  const rowsToInsert = (data.items || []).map((item: any) => ({
    tanggal: data.tanggal,
    waktu: data.waktu,
    mod: data.mod,
    pic: picNames,
    counter: item.counter,
    nama_produk: item.nama,
    nilai: item.nilai,
    komentar: item.comment,
  }));

  const { error } = await supabase.from('test_food_records').insert(rowsToInsert);
  if (error) return Response.json({ success: false, message: error.message });

  // Item MANUAL dari tester disimpan balik ke pic_submissions divisi terkait,
  // supaya ke depannya PIC/tester tidak perlu input manual lagi untuk menu yang sama.
  try {
    const manualItems = (data.items || []).filter((item: any) => item.source === 'MANUAL');
    if (manualItems.length > 0) {
      const byDivisi: Record<string, any[]> = {};
      for (const item of manualItems) {
        const d = counterToDivisi(item.counter);
        if (!byDivisi[d]) byDivisi[d] = [];
        byDivisi[d].push(item);
      }
      const keyOf = (c: string, n: string) => `${String(c || '').trim().toUpperCase()}|${String(n || '').trim().toLowerCase()}`;
      for (const div of Object.keys(byDivisi)) {
        const existing = rows.find((r: any) => String(r.divisi || 'DELICA').toUpperCase() === div);
        const existingItems: any[] = existing && Array.isArray(existing.items) ? existing.items : [];
        const existingKeys = new Set(existingItems.map((it: any) => keyOf(it.counter, it.nama)));
        const newEntries = byDivisi[div]
          .filter((item: any) => !existingKeys.has(keyOf(item.counter, item.nama)))
          .map((item: any) => ({ counter: item.counter, nama: item.nama }));
        if (newEntries.length === 0) continue;
        const mergedItems = [...existingItems, ...newEntries];
        if (existing) {
          await supabase
            .from('pic_submissions')
            .update({ items: mergedItems, updated_at: new Date().toISOString() })
            .eq('tanggal', data.tanggal)
            .eq('waktu', data.waktu)
            .eq('divisi', div);
        } else if (div !== 'DELICA') {
          await supabase.from('pic_submissions').insert({
            tanggal: data.tanggal,
            waktu: data.waktu,
            divisi: div,
            nama_pic: null,
            signature_url: null,
            items: newEntries,
          });
        }
      }
    }
  } catch (mergeErr) {
    console.error('Gagal merge item manual ke pic_submissions:', mergeErr);
    // Tidak fatal - data test_food_records tetap tersimpan walau merge ini gagal
  }

  try {
    const rank = (d: string) => {
      const i = DIVISI_ORDER.indexOf(String(d || 'DELICA').toUpperCase() as any);
      return i === -1 ? 99 : i;
    };
    const ordered = [...rows].sort(
      (a: any, b: any) => rank(a.divisi) - rank(b.divisi)
    );
    const sigUrls = ordered.map((r: any) => r.signature_url || null);

    const reportWarnings: string[] = [];
    const httpUrls = sigUrls.filter(
      (u: string | null): u is string => !!u && u.startsWith('http')
    );
    let compositeUrl: string | null = httpUrls[0] || null;
    if (httpUrls.length > 1) {
      const composite = await compositeSignaturesHorizontal(httpUrls, reportWarnings);
      if (composite) {
        const fileName = `pic_composite_${data.tanggal}_${data.waktu}_${Date.now()}.png`;
        const { error: upErr } = await supabase.storage
          .from('signatures')
          .upload(fileName, composite, { contentType: 'image/png', upsert: true });
        if (!upErr) {
          const { data: pub } = supabase.storage.from('signatures').getPublicUrl(fileName);
          compositeUrl = pub.publicUrl;
        } else {
          reportWarnings.push(`Gagal upload TTD PIC gabungan: ${upErr.message}`);
        }
      } else {
        reportWarnings.push('TTD PIC gabungan gagal dibuat, pakai TTD pertama');
      }
    }

    const result = await generateReport(data, picNames, compositeUrl, supabase);
    result.warnings.unshift(...reportWarnings);
    return Response.json({
      success: true,
      url: result.url,
      message: result.warnings.length > 0 ? result.warnings.join(' | ') : undefined,
    });
  } catch (e: any) {
    const detail = e?.response?.data?.error?.message || e?.errors?.[0]?.message || e?.message || e.toString();
    return Response.json({
      success: true,
      url: null,
      message: 'Data tersimpan, tapi laporan gagal dibuat: ' + detail,
    });
  }
}
