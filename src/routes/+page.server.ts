import { getAvailableWeeks, getWeeklyMatchupDoc, getSeasonDoc } from '$lib/fantasyDataService';
import { processWeek } from '$lib/weekProcessor';
import { LEAGUE_ID, OWNER_DICT } from '$env/static/private';

export async function load({ url }) {
	try {
		const availableWeeks = await getAvailableWeeks(LEAGUE_ID);
		if (availableWeeks.length === 0) return { availableWeeks: [], weekData: null };

		const seasonParam = url.searchParams.get('season');
		const weekParam = url.searchParams.get('week');

		const target = seasonParam && weekParam
			? availableWeeks.find(
				(w) => w.seasonId === parseInt(seasonParam) && w.scoringPeriodId === parseInt(weekParam)
			) ?? availableWeeks[0]
			: availableWeeks[0];

		const [weekDoc, seasonDoc] = await Promise.all([
			getWeeklyMatchupDoc(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
			getSeasonDoc(LEAGUE_ID, target.seasonId)
		]);

		const ownerDict: Record<string, string> = JSON.parse(OWNER_DICT || '{}');
		const weekData = weekDoc && seasonDoc ? processWeek(weekDoc, seasonDoc, ownerDict) : null;

		return { availableWeeks, weekData };
	} catch (error) {
		console.error('Page load error:', error);
		return {
			availableWeeks: [],
			weekData: null,
			error: error instanceof Error ? error.message : 'Failed to load data'
		};
	}
}
