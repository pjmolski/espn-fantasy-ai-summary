import { json } from '@sveltejs/kit';
import { LEAGUE_ID } from '$env/static/private';
import { getAvailableWeeks } from '$lib/fantasyDataService';

export async function GET() {
	const weeks = await getAvailableWeeks(LEAGUE_ID);
	return json(weeks);
}
