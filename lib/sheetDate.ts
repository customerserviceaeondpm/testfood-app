// Google Sheets bisa menyimpan tanggal dalam berbagai bentuk (teks "2026-05-24",
// atau format lokal seperti "24/05/2026", atau serial date). Fungsi ini mencoba
// menyeragamkan semuanya jadi "yyyy-MM-dd" sebelum disimpan ke Supabase.
export function normalizeSheetDate(value: any): string {
  if (!value) return '';
  const str = String(value).trim();

  // Sudah format yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  // Format dd/mm/yyyy atau dd-mm-yyyy (umum kalau sheet pakai locale Indonesia).
  // JavaScript Date() salah mengartikan ini sebagai mm/dd/yyyy, jadi ditangani manual dulu.
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Fallback terakhir: coba parse pakai Date bawaan
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return str;
}
