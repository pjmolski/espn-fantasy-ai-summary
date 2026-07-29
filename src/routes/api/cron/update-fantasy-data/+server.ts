import { json } from '@sveltejs/kit';
import { updateFantasyData } from '$lib/fantasyDataService';
import { CRON_SECRET } from '$env/static/private';

export async function GET({ request, url }) {
	const authHeader = request.headers.get('authorization');
	if (authHeader !== `Bearer ${CRON_SECRET}`) {
		return new Response('Unauthorized', { status: 401 });
	}
	try {
		const week = url.searchParams.get('week') ? parseInt(url.searchParams.get('week')!) : undefined;
		const season = url.searchParams.get('season') ? parseInt(url.searchParams.get('season')!) : undefined;
		await updateFantasyData(week, season);
		return json({ message: `Fantasy data updated successfully (season: ${season}, week: ${week})` });
	} catch (error) {
		console.error('Cron job error:', error);
		return json({ error: 'Failed to update fantasy data' }, { status: 500 });
	}
}
