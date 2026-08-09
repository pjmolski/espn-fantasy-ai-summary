import { json } from '@sveltejs/kit';
import { CRON_SECRET } from '$env/static/private';
import { syncTrades } from '$lib/tradeSync';
import { getLastSyncTime } from '$lib/cookieStore';

// Called by: weekly cron, or the "Sync Trades" button on the page
export async function POST({ request }) {
	const auth = request.headers.get('authorization');
	if (auth !== `Bearer ${CRON_SECRET}`) {
		return new Response('Unauthorized', { status: 401 });
	}
	const result = await syncTrades();
	const lastSync = await getLastSyncTime();
	return json({ ...result, lastSync });
}

export async function GET({ request }) {
	const auth = request.headers.get('authorization');
	if (auth !== `Bearer ${CRON_SECRET}`) {
		return new Response('Unauthorized', { status: 401 });
	}
	const lastSync = await getLastSyncTime();
	return json({ lastSync });
}
