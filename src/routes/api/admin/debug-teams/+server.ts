import { json } from '@sveltejs/kit';
import { getSeasonDoc } from '$lib/fantasyDataService';
import { LEAGUE_ID } from '$env/static/private';

export async function GET({ url }) {
	const year = Number(url.searchParams.get('year') ?? 2025);
	const doc = await getSeasonDoc(LEAGUE_ID, year);
	if (!doc) return json({ error: 'No season doc found' }, { status: 404 });
	return json({
		seasonId: doc.seasonId,
		teams: doc.teams.map(t => ({
			teamId: t.teamId,
			name: t.name,
			abbreviation: t.abbreviation,
			owners: t.owners
		}))
	});
}
