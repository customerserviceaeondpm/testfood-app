-- Jalankan seluruh isi file ini di Supabase SQL Editor

-- 1. Master produk per counter
create table if not exists products (
  id bigint generated always as identity primary key,
  counter text not null,
  product_name text not null,
  created_at timestamptz default now()
);

-- 2. Input harian dari PIC (menu + tanda tangan)
create table if not exists pic_submissions (
  id bigint generated always as identity primary key,
  tanggal date not null,
  waktu text not null check (waktu in ('PAGI','SORE')),
  nama_pic text,
  signature_url text,
  items jsonb not null default '[]',
  updated_at timestamptz default now(),
  unique (tanggal, waktu)
);

-- 3. Draft tester (sebelum submit final)
create table if not exists tester_drafts (
  id bigint generated always as identity primary key,
  tanggal date not null,
  waktu text not null check (waktu in ('PAGI','SORE')),
  mod text,
  data jsonb not null default '{}',
  updated_at timestamptz default now(),
  unique (tanggal, waktu)
);

-- 4. Database hasil test food final (baris per-item)
create table if not exists test_food_records (
  id bigint generated always as identity primary key,
  submitted_at timestamptz default now(),
  tanggal date not null,
  waktu text not null check (waktu in ('PAGI','SORE')),
  mod text,
  pic text,
  counter text,
  nama_produk text,
  nilai smallint,
  komentar text
);
create index if not exists idx_records_tanggal on test_food_records (tanggal);
create index if not exists idx_records_shift on test_food_records (tanggal, waktu);

-- 5. Riwayat laporan yang di-generate (PDF/PNG/XLSX)
create table if not exists generated_reports (
  id bigint generated always as identity primary key,
  tanggal date not null,
  waktu text not null,
  format text not null,
  file_url text not null,
  created_at timestamptz default now()
);

-- Aktifkan RLS. Karena semua akses lewat backend Vercel dengan service_role key,
-- tidak perlu policy tambahan untuk MVP ini (service_role otomatis bypass RLS).
alter table products enable row level security;
alter table pic_submissions enable row level security;
alter table tester_drafts enable row level security;
alter table test_food_records enable row level security;
alter table generated_reports enable row level security;

-- Setelah tabel dibuat, jangan lupa buat 2 storage bucket lewat dashboard Supabase:
--   1. "signatures" (public)
--   2. "reports"    (public)
