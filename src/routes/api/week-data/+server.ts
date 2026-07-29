import { json } from '@sveltejs/kit';
import { LEAGUE_ID } from '$env/static/private';
import { getWeeklyMatchupDoc, getSeasonDoc } from '$lib/fantasyDataService';
import { processWeek } from '$lib/weekProcessor';

export async function GET({ url }) {
	const season = url.searchParams.get('season');
	const week = url.searchParams.get('week');

	if (!season || !week) {
		return json({ error: 'season and week params required' }, { status: 400 });
	}

	const seasonId = parseInt(season);
	const weekId = parseInt(week);

	const [weekDoc, seasonDoc] = await Promise.all([
		getWeeklyMatchupDoc(LEAGUE_ID, seasonId, weekId),
		getSeasonDoc(LEAGUE_ID, seasonId)
	]);

	if (!weekDoc) return json({ error: `No data for season ${seasonId} week ${weekId}` }, { status: 404 });
	if (!seasonDoc) return json({ error: `No season doc for ${seasonId}` }, { status: 404 });

	const processed = processWeek(weekDoc, seasonDoc);
	return json(processed);
}
