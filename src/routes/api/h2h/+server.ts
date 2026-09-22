import { json } from '@sveltejs/kit';
import { LEAGUE_ID } from '$env/static/private';
import { getAllSeasons, getAllMatchupsAllSeasons } from '$lib/fantasyDataService';

export async function GET({ url }) {
	const team1 = parseInt(url.searchParams.get('team1') ?? '0');
	const team2 = parseInt(url.searchParams.get('team2') ?? '0');
	if (!team1 || !team2 || team1 === team2) return json({ error: 'Invalid teams' }, { status: 400 });

	// Build seasonId → teamId → name map so each game uses that season's name
	const seasons = await getAllSeasons(LEAGUE_ID);
	const seasonNames = new Map<number, Map<number, string>>();
	for (const s of seasons) {
		const m = new Map<number, string>();
		for (const t of s.teams) m.set(t.teamId, t.name);
		seasonNames.set(s.seasonId, m);
	}
	const nameFor = (seasonId: number, teamId: number) =>
		seasonNames.get(seasonId)?.get(teamId) ?? `Team ${teamId}`;

	// Fetch all weekly matchup docs that involve these two teams
	const all = await getAllMatchupsAllSeasons(LEAGUE_ID);

	const matchups: {
		seasonId: number; week: number;
		homeTeamId: number; homeTeamName: string; homeScore: number;
		awayTeamId: number; awayTeamName: string; awayScore: number;
		winner: string;
	}[] = [];

	for (const doc of all) {
		for (const m of doc.matchups) {
			if (!m.away) continue;
			const ids = new Set([m.home.teamId, m.away.teamId]);
			if (!ids.has(team1) || !ids.has(team2)) continue;
			matchups.push({
				seasonId:     doc.seasonId,
				week:         doc.scoringPeriodId,
				homeTeamId:   m.home.teamId,
				homeTeamName: nameFor(doc.seasonId, m.home.teamId),
				homeScore:    m.home.totalPoints,
				awayTeamId:   m.away.teamId,
				awayTeamName: nameFor(doc.seasonId, m.away.teamId),
				awayScore:    m.away.totalPoints,
				winner:       m.winner.toLowerCase()
			});
		}
	}

	// Sort newest first for display
	matchups.sort((a, b) => b.seasonId - a.seasonId || b.week - a.week);

	return json({ matchups });
}
