# Test Food Form DPM — Next.js + Supabase

MVP hasil migrasi dari Google Apps Script + Sheets. Mekanisme dan tampilan (Bootstrap, SweetAlert2, SignaturePad) sengaja dibuat sama persis dengan versi lama — yang berubah hanya cara komunikasi ke backend (`google.script.run` → `fetch` ke API Next.js) dan tempat penyimpanan data (Sheets → Supabase).

## 1. Setup Supabase

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, jalankan seluruh isi file `supabase/schema.sql`.
3. Buka **Storage**, buat 2 bucket:
   - `signatures` (public)
   - `reports` (public)
4. Buka **Project Settings → API**, salin `Project URL`, `anon public key`, dan `service_role key`.
5. Isi tabel `products` dengan data counter & menu (bisa import CSV dari `Master_Produk` lama lewat Table Editor).

## 2. Jalankan lokal

```bash
cp .env.example .env.local
# isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di .env.local

npm install
npm run dev
```

Buka:
- `http://localhost:3000/tester.html` — form tester (dulu `Index.html`)
- `http://localhost:3000/pic.html` — form PIC (dulu `FormPIC.html`)
- `http://localhost:3000/dashboard.html` — dashboard monitoring (dulu `Dashboard.html`)

## 3. Deploy ke Vercel

1. Push folder ini ke repo GitHub.
2. Import repo di [vercel.com/new](https://vercel.com/new).
3. Di **Environment Variables**, isi `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` (minimal itu untuk MVP ini berjalan).
4. Deploy.

## 4. Yang sudah berfungsi

- Ambil daftar produk per counter (`/api/products`)
- Input & ambil data PIC harian + tanda tangan tersimpan di Supabase Storage (`/api/pic`)
- Simpan & muat ulang draft tester (`/api/tester/draft`)
- Submit final: simpan ke `test_food_records`, lalu generate laporan (`/api/submit`)
- Dashboard kalender, detail harian, dan rekap issue per counter (`/api/dashboard`, `/api/detail`, `/api/issues`)
- Generate laporan **PDF** dan **Excel**, otomatis ter-upload ke Supabase Storage bucket `reports`

## 5. Yang masih perlu disempurnakan (belum termasuk di MVP ini)

- **Layout laporan PDF/Excel** di `lib/report.ts` masih versi sederhana (tabel counter/produk/nilai/komentar), belum meniru persis layout `Template_PDF` lama yang punya posisi sel spesifik, tanda tangan MOD & PIC di posisi tetap, dsb. Perlu digambar ulang sesuai kebutuhan.
- **Output PNG** untuk sementara ikut menghasilkan PDF (belum ada konversi PDF→PNG). Bisa ditambahkan pakai Puppeteer screenshot atau layanan konversi eksternal.
- **Sinkronisasi dua arah ke Google Sheets** belum diimplementasikan — ini fungsi terpisah yang perlu ditambahkan (lihat bagian "Mekanisme Sinkronisasi Dua Arah" di panduan migrasi sebelumnya): butuh Google Service Account, lalu buat endpoint `/api/sync/from-sheets` (webhook dari Apps Script trigger) dan job berkala (Vercel Cron) yang menulis balik ke Sheets lewat Google Sheets API.
- **RLS Supabase** saat ini mengandalkan `service_role key` di server (bypass RLS). Kalau nanti ada bagian yang perlu diakses langsung dari browser tanpa lewat API Next.js, perlu dibuat policy RLS yang lebih rinci.
- **Migrasi data lama** dari sheet ke tabel Supabase (`products`, `test_food_records`, dst) belum dijalankan — ikuti langkah export CSV → import di Supabase Table Editor.

## 6. Struktur folder

```
app/
  page.tsx              → redirect ke /tester.html
  api/
    products/route.ts   → GET daftar produk per counter
    pic/route.ts         → GET & POST data PIC harian
    tester/draft/route.ts→ GET & POST draft tester
    submit/route.ts      → POST submit final + generate laporan
    dashboard/route.ts   → GET data kalender
    detail/route.ts      → GET detail per tanggal
    issues/route.ts      → GET rekap issue per bulan
lib/
  supabase.ts           → helper koneksi Supabase (server-only)
  report.ts             → generator PDF & Excel
public/
  tester.html            → form tester
  pic.html                → form PIC
  dashboard.html          → dashboard monitoring
supabase/
  schema.sql             → skema tabel, jalankan di SQL Editor
```
