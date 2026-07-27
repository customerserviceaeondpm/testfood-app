// Google Sheets bisa menyimpan tanggal dalam berbagai bentuk (teks "2026-05-24",
// atau format lokal seperti "24/05/2026", atau serial date). Fungsi ini mencoba
// menyeragamkan semuanya jadi "yyyy-MM-dd" sebelum disimpan ke Supabase.
export function normalizeSheetDate(value: any): string {
  if (!value) return '';
  const str = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return str;
}
