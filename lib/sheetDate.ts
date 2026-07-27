// Google Sheets bisa menyimpan tanggal dalam berbagai bentuk:
// - teks "2026-07-27"
// - format lokal "27/07/2026"
// - angka serial (misal "46220" = jumlah hari sejak 30 Des 1899, format asli Sheets/Excel)
// Fungsi ini mencoba menyeragamkan semuanya jadi "yyyy-MM-dd" sebelum disimpan ke Supabase.
// Kalau tidak bisa dikenali / hasilnya tidak masuk akal, kembalikan string kosong
// supaya baris itu dilewati (bukan malah memaksa tanggal yang salah masuk ke database).
export function normalizeSheetDate(value: any): string {
  if (value === null || value === undefined || value === '') return '';
  const str = String(value).trim();

  // Sudah format yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);

  // Format dd/mm/yyyy atau dd-mm-yyyy (umum kalau sheet pakai locale Indonesia)
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return isValidYear(parseInt(y, 10))
      ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      : '';
  }

  // Angka serial murni (format asli Google Sheets/Excel, dihitung sejak 30 Des 1899)
  if (/^\d+(\.\d+)?$/.test(str)) {
    const serial = parseFloat(str);
    const epochMs = Date.UTC(1899, 11, 30);
    const ms = epochMs + serial * 86400000;
    const d = new Date(ms);
    if (!isNaN(d.getTime()) && isValidYear(d.getUTCFullYear())) {
      return d.toISOString().slice(0, 10);
    }
    return '';
  }

  // Fallback terakhir: coba parse pakai Date bawaan, tapi validasi tahunnya masuk akal
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && isValidYear(parsed.getFullYear())) {
    return parsed.toISOString().slice(0, 10);
  }

  return '';
}

function isValidYear(year: number): boolean {
  return year >= 2000 && year <= 2100;
}
