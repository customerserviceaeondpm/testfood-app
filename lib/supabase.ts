import { createClient } from '@supabase/supabase-js';

// Hanya dipakai di server (API routes). Jangan pernah import file ini di komponen client,
// karena SUPABASE_SERVICE_ROLE_KEY punya akses penuh dan wajib tetap rahasia.
export function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
