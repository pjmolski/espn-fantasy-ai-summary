import { json } from '@sveltejs/kit';
import { LEAGUE_ID } from '$env/static/private';
import { getWeeklyMatchupDoc, getSeasonDoc, getCumulativeScoresByWeek, getAllWeeklyDocs } from '$lib/fantasyDataService';
import { processWeek } from '$lib/weekProcessor';
import { computeStandingsHistory, computeStreaks } from '$lib/standingsHistory';

export async function GET({ url }) {
	const season = url.searchParams.get('season');
	const week = url.searchParams.get('week');

	if (!season || !week) {
		return json({ error: 'season and week params required' }, { status: 400 });
	}

	const seasonId = parseInt(season);
	const weekId = parseInt(week);

	const [weekDoc, seasonDoc, prevScores, allDocs] = await Promise.all([
		getWeeklyMatchupDoc(LEAGUE_ID, seasonId, weekId),
		getSeasonDoc(LEAGUE_ID, seasonId),
		getCumulativeScoresByWeek(LEAGUE_ID, seasonId, weekId),
		getAllWeeklyDocs(LEAGUE_ID, seasonId, weekId)
	]);

	if (!weekDoc) return json({ error: `No data for season ${seasonId} week ${weekId}` }, { status: 404 });
	if (!seasonDoc) return json({ error: `No season doc for ${seasonId}` }, { status: 404 });

	const streaks = computeStreaks(allDocs);
	const processed = processWeek(weekDoc, seasonDoc, {}, prevScores, streaks);
	const standingsHistory = computeStandingsHistory(allDocs, seasonDoc);

	if (processed.isPlayoffWeek) {
		for (const entry of standingsHistory) {
			const lastRank = entry.weeklyRanks[entry.weeklyRanks.length - 1]?.rank;
			if (lastRank === 1) processed.brassNuts = { teamId: entry.teamId, teamName: entry.teamName };
			if (lastRank === 7) processed.toiletBowl = { teamId: entry.teamId, teamName: entry.teamName };
		}
	}

	return json({ weekData: processed, standingsHistory });
}
