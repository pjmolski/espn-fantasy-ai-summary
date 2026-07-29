import { json } from '@sveltejs/kit';
import { getSeasonDoc } from '$lib/fantasyDataService';
import { fetchLeagueSeason } from '$lib/espnApi';
import { LEAGUE_ID } from '$env/static/private';

export async function GET({ url }) {
	const year = Number(url.searchParams.get('year') ?? 2025);
	const source = url.searchParams.get('source') ?? 'db'; // 'db' or 'live'

	if (source === 'live') {
		// Fetch raw from ESPN so we can inspect all team fields
		const raw = await fetchLeagueSeason(LEAGUE_ID, year);
		const teams = (raw.teams ?? []).map((t: any) => ({
			id: t.id,
			location: t.location,
			nickname: t.nickname,
			name: t.name,
			abbrev: t.abbrev,
			// any other name-like keys
			...Object.fromEntries(
				Object.entries(t).filter(([k]) =>
					['logo','logoType','primaryOwner','owners','divisionId','playoffSeed','rankCalculatedFinal'].includes(k)
				)
			)
		}));
		return json({ source: 'live', seasonId: year, teamCount: raw.teams?.length ?? 0, teams });
	}

	// DB source
	const doc = await getSeasonDoc(LEAGUE_ID, year);
	if (!doc) return json({ error: 'No season doc found' }, { status: 404 });
	return json({
		source: 'db',
		seasonId: doc.seasonId,
		teams: doc.teams.map(t => ({
			teamId: t.teamId,
			name: t.name,
			abbreviation: t.abbreviation,
			owners: t.owners
		}))
	});
}
