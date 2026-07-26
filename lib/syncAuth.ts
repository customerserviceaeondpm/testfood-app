// Melindungi endpoint sync supaya tidak sembarang orang bisa memicunya.
// Vercel Cron otomatis mengirim header "Authorization: Bearer <CRON_SECRET>".
// Untuk trigger manual lewat browser, bisa juga pakai ?secret=<CRON_SECRET> di URL.
export function isSyncAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;

  return false;
}
