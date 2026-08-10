import { getAvailableWeeks, getWeeklyMatchupDoc, getSeasonDoc, getCumulativeScoresByWeek, getAllWeeklyDocs, getAllSeasonDocs, computeAllTimeH2H, getH2H } from '$lib/fantasyDataService';
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

		const [weekDoc, seasonDoc, prevScores, weekDocs, allSeasonDocs, h2hRecords] = await Promise.all([
			getWeeklyMatchupDoc(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
			getSeasonDoc(LEAGUE_ID, target.seasonId),
			getCumulativeScoresByWeek(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
			getAllWeeklyDocs(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
			getAllSeasonDocs(LEAGUE_ID, target.seasonId),
			computeAllTimeH2H(LEAGUE_ID)
		]);

		const ownerDict: Record<string, string> = JSON.parse(OWNER_DICT || '{}');
		// Streaks are as-of the selected week; standings/bracket use the full season.
		const streaks = computeStreaks(weekDocs);

		// Compute playoff bracket (no-op for regular season weeks)
		const bracket = seasonDoc ? computePlayoffBracket(allSeasonDocs, seasonDoc) : null;
		const playoffRound = bracket && weekDoc ? getPlayoffRoundForWeek(bracket, weekDoc.scoringPeriodId) : null;

		const weekData = weekDoc && seasonDoc
			? processWeek(weekDoc, seasonDoc, ownerDict, prevScores, streaks, playoffRound, bracket?.seeds ?? null)
			: null;
		const rawHistory = seasonDoc ? computeStandingsHistory(allSeasonDocs, seasonDoc, bracket ?? undefined) : [];

		// Clip standings to the selected week so the chart is a snapshot of that moment.
		// The x-axis still spans the full season (handled by buildChart using availableWeeks).
		const standingsHistory = rawHistory.map(entry => ({
			...entry,
			weeklyRanks: entry.weeklyRanks.filter(r => r.week <= target.scoringPeriodId)
		}));

		// Inject championship awards: only when final ranks are fully resolved (lo===hi)
		if (weekData?.isPlayoffWeek) {
			for (const entry of standingsHistory) {
				const lastRank = entry.weeklyRanks[entry.weeklyRanks.length - 1]?.rank;
				if (lastRank === 1) weekData.brassNuts = { teamId: entry.teamId, teamName: entry.teamName };
				if (lastRank === 7) weekData.toiletBowl = { teamId: entry.teamId, teamName: entry.teamName };
			}
		}

		// Compute W-L record for each team as of the selected week
		const teamRecords: Record<number, { wins: number; losses: number }> = {};
		for (const doc of weekDocs) {
			for (const m of doc.matchups) {
				if (!m.away || m.winner === 'UNDECIDED') continue;
				const homeId = m.home.teamId;
				const awayId = m.away.teamId;
				if (!teamRecords[homeId]) teamRecords[homeId] = { wins: 0, losses: 0 };
				if (!teamRecords[awayId]) teamRecords[awayId] = { wins: 0, losses: 0 };
				if (m.winner === 'HOME') { teamRecords[homeId].wins++; teamRecords[awayId].losses++; }
				else if (m.winner === 'AWAY') { teamRecords[awayId].wins++; teamRecords[homeId].losses++; }
			}
		}

		// Build per-matchup H2H records (serialisable plain object)
		const matchupH2H: Record<string, { homeWins: number; awayWins: number; ties: number }> = {};
		if (weekData) {
			for (const m of weekData.matchups) {
				if (!m.away) continue;
				const { aWins, bWins, ties } = getH2H(h2hRecords, m.home.teamId, m.away.teamId);
				matchupH2H[m.matchupId] = { homeWins: aWins, awayWins: bWins, ties };
			}
		}

		return { availableWeeks, weekData, standingsHistory, matchupH2H, teamRecords };
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
