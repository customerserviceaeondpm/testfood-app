import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { generatePdfFromTemplate } from './pdfTemplate';

// CATATAN:
// - outputType "PDF" sekarang memakai template asli "Template_PDF" di Google Sheets
//   (lihat lib/pdfTemplate.ts), hasilnya disimpan ke folder Google Drive.
// - outputType "EXCEL" masih pakai versi sederhana lewat exceljs, tersimpan ke Supabase Storage.
// - outputType "PNG" untuk sementara ikut menghasilkan PDF sederhana (belum ada konversi PDF->PNG).
export async function generateReport(data: any, namaPic: string, sigPicUrl: string | null, supabase: any) {
  const fileName = `Report_TestFood_${data.tanggal}_${data.waktu}`;

  if (data.outputType === 'EXCEL') {
    return await generateExcel(data, namaPic, supabase, fileName);
  }

  if (data.outputType === 'PDF') {
    const url = await generatePdfFromTemplate(data, namaPic, sigPicUrl, supabase);
    await supabase.from('generated_reports').insert({
      tanggal: data.tanggal, waktu: data.waktu, format: 'PDF', file_url: url,
    });
    return url;
  }

  return await generatePdf(data, namaPic, supabase, fileName);
}

async function generatePdf(data: any, namaPic: string, supabase: any, fileName: string) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([595, 842]); // A4 potrait
  let y = 800;

  const drawText = (text: string, x: number, size = 10, f = font) => {
    page.drawText(text, { x, y, size, font: f, color: rgb(0, 0, 0) });
  };

  drawText('LAPORAN TEST FOOD - AEON DP MALL', 40, 16, bold); y -= 24;
  drawText(`Tanggal: ${data.tanggal}   Shift: ${data.waktu}`, 40); y -= 16;
  drawText(`MOD: ${data.mod || '-'}   PIC: ${namaPic || '-'}`, 40); y -= 24;

  drawText('Counter', 40, 10, bold);
  drawText('Produk', 140, 10, bold);
  drawText('Nilai', 380, 10, bold);
  drawText('Komentar', 430, 10, bold);
  y -= 14;

  for (const item of data.items || []) {
    if (y < 60) { page = pdfDoc.addPage([595, 842]); y = 800; }
    drawText(String(item.counter || ''), 40, 9);
    drawText(String(item.nama || '').slice(0, 35), 140, 9);
    drawText(String(item.nilai || ''), 380, 9);
    drawText(String(item.comment || '').slice(0, 25), 430, 9);
    y -= 14;
  }

  const bytes = await pdfDoc.save();
  const path = `${fileName}.pdf`;
  const { error } = await supabase.storage.from('reports').upload(path, Buffer.from(bytes), {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(error.message);

  const { data: pub } = supabase.storage.from('reports').getPublicUrl(path);
  await supabase.from('generated_reports').insert({
    tanggal: data.tanggal, waktu: data.waktu, format: 'PDF', file_url: pub.publicUrl,
  });

  return pub.publicUrl;
}

async function generateExcel(data: any, namaPic: string, supabase: any, fileName: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');

  sheet.addRow(['LAPORAN TEST FOOD - AEON DP MALL']);
  sheet.addRow([`Tanggal: ${data.tanggal}`, `Shift: ${data.waktu}`]);
  sheet.addRow([`MOD: ${data.mod || '-'}`, `PIC: ${namaPic || '-'}`]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(['Counter', 'Produk', 'Nilai', 'Komentar']);
  headerRow.font = { bold: true };

  for (const item of data.items || []) {
    sheet.addRow([item.counter, item.nama, item.nilai, item.comment]);
  }
  sheet.columns.forEach(col => { col.width = 25; });

  const buffer = await workbook.xlsx.writeBuffer();
  const path = `${fileName}.xlsx`;
  const { error } = await supabase.storage.from('reports').upload(path, Buffer.from(buffer), {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true,
  });
  if (error) throw new Error(error.message);

  const { data: pub } = supabase.storage.from('reports').getPublicUrl(path);
  await supabase.from('generated_reports').insert({
    tanggal: data.tanggal, waktu: data.waktu, format: 'EXCEL', file_url: pub.publicUrl,
  });

  return pub.publicUrl;
}
