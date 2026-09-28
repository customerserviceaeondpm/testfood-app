// Public config endpoint untuk dashboard
export async function GET() {
  return Response.json({
    syncSecret: process.env.CRON_SECRET || '',
  });
}
