// Legacy AI-summary cron — removed. Use /api/admin/backfill instead.
export async function GET() {
	return new Response('Gone', { status: 410 });
}
