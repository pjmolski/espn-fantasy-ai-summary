import { getAvailableWeeks, getWeeklyMatchupDoc, getSeasonDoc, getCumulativeScoresByWeek, getAllWeeklyDocs } from '$lib/fantasyDataService';
import { processWeek } from '$lib/weekProcessor';
import { computeStandingsHistory, computeStreaks } from '$lib/standingsHistory';
import { computePlayoffBracket, getPlayoffRoundForWeek } from '$lib/playoffBracket';
import { LEAGUE_ID, OWNER_DICT } from '$env/static/private';

export async function load({ url }) {
	try {
		const availableWeeks = await getAvailableWeeks(LEAGUE_ID);
		if (availableWeeks.length === 0) return { availableWeeks: [], weekData: null, standingsHistory: [] };

		const seasonParam = url.searchParams.get('season');
		const weekParam = url.searchParams.get('week');

		const target = seasonParam && weekParam
			? availableWeeks.find(
				(w) => w.seasonId === parseInt(seasonParam) && w.scoringPeriodId === parseInt(weekParam)
			) ?? availableWeeks[0]
			: availableWeeks[0];

		const [weekDoc, seasonDoc, prevScores, allDocs] = await Promise.all([
			getWeeklyMatchupDoc(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
			getSeasonDoc(LEAGUE_ID, target.seasonId),
			getCumulativeScoresByWeek(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
			getAllWeeklyDocs(LEAGUE_ID, target.seasonId, target.scoringPeriodId)
		]);

		const ownerDict: Record<string, string> = JSON.parse(OWNER_DICT || '{}');
		const streaks = computeStreaks(allDocs);

		// Compute playoff bracket (no-op for regular season weeks)
		const bracket = seasonDoc ? computePlayoffBracket(allDocs, seasonDoc) : null;
		const playoffRound = bracket && weekDoc ? getPlayoffRoundForWeek(bracket, weekDoc.scoringPeriodId) : null;

		const weekData = weekDoc && seasonDoc
			? processWeek(weekDoc, seasonDoc, ownerDict, prevScores, streaks, playoffRound, bracket?.seeds ?? null)
			: null;
		const standingsHistory = seasonDoc ? computeStandingsHistory(allDocs, seasonDoc, bracket ?? undefined) : [];

		// Inject championship awards: only when final ranks are fully resolved (lo===hi)
		if (weekData?.isPlayoffWeek) {
			for (const entry of standingsHistory) {
				const lastRank = entry.weeklyRanks[entry.weeklyRanks.length - 1]?.rank;
				if (lastRank === 1) weekData.brassNuts = { teamId: entry.teamId, teamName: entry.teamName };
				if (lastRank === 7) weekData.toiletBowl = { teamId: entry.teamId, teamName: entry.teamName };
			}
		}

		return { availableWeeks, weekData, standingsHistory };
	} catch (error) {
		console.error('Page load error:', error);
		return {
			availableWeeks: [],
			weekData: null,
			standingsHistory: [],
			error: error instanceof Error ? error.message : 'Failed to load data'
		};
	}
}
