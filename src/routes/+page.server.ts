import { getLatestFantasyData, getFantasyDataByWeek, getAllWeeks } from '$lib/fantasyDataService';

export async function load({ url }) {
	try {
		const weekParam = url.searchParams.get('week');
		const seasonParam = url.searchParams.get('season');
		const availableWeeks = await getAllWeeks();

		let weeklyData;
		if (weekParam && seasonParam) {
			weeklyData = await getFantasyDataByWeek(parseInt(weekParam), parseInt(seasonParam));
		} else {
			weeklyData = await getLatestFantasyData();
		}

		return { weeklyData, availableWeeks };
	} catch (error) {
		console.error('Error loading fantasy data:', error);
		return {
			error: error instanceof Error ? error.message : 'Failed to load fantasy football data',
			availableWeeks: []
		};
	}
}
