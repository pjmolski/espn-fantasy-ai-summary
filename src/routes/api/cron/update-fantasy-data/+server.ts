import { json } from '@sveltejs/kit';
import { CRON_SECRET, LEAGUE_ID } from '$env/static/private';
import { ingestSeasonData, ingestWeeklyData, getAvailableWeeks } from '$lib/fantasyDataService';
import { getNFLSeason } from '$lib/utils';
import { getEspnCookies } from '$lib/cookieStore';
import { fetchLeagueSeason } from '$lib/espnApi';

/**
 * Vercel cron endpoint — fires every Tuesday at 11am UTC (after Monday Night Football).
 * Ingests only COMPLETED weeks (up to espnCurrentWeek - 1).
 *
 * Vercel automatically sends: Authorization: Bearer <CRON_SECRET>
 * Configured in vercel.json → crons → schedule "0 11 * * 2"
 *
 * Key: we stop at espnCurrentWeek - 1 so we never store the currently-in-progress
 * week with partial/zero scores, which would break preview detection.
 */
export async function GET({ request }) {
	const authHeader = request.headers.get('authorization');
	if (authHeader !== `Bearer ${CRON_SECRET}`) {
		return new Response('Unauthorized', { status: 401 });
	}

	const currentYear = getNFLSeason();
	const cookieStore = await getEspnCookies();
	const cookies = cookieStore
		? { swid: cookieStore.swid, espn_s2: cookieStore.espn_s2 }
		: undefined;

	// Ask ESPN what week is currently active
	const raw = await fetchLeagueSeason(LEAGUE_ID, currentYear, cookies);
	const espnCurrentWeek: number = raw.scoringPeriodId ?? 0;

	// Only ingest weeks that have fully completed — not the one being played right now
	const lastCompletedWeek = espnCurrentWeek - 1;

	if (lastCompletedWeek < 1) {
		return json({ ok: true, message: 'Season not started yet', espnCurrentWeek });
	}

	// Find the latest week we already have stored for this season
	const allWeeks = await getAvailableWeeks(LEAGUE_ID);
	const seasonWeeks = allWeeks.filter(w => w.seasonId === currentYear);
	const latestStored = seasonWeeks.length > 0
		? Math.max(...seasonWeeks.map(w => w.scoringPeriodId))
		: 0;

	// Refresh season doc (team names, settings)
	const seasonDoc = await ingestSeasonData(LEAGUE_ID, currentYear, cookies);
	const regularSeasonWeeks = seasonDoc.settings.regularSeasonWeeks;

	// Ingest any completed weeks we're missing
	let weeksFetched = 0;
	let weeksSkipped = 0;
	for (let week = latestStored + 1; week <= lastCompletedWeek; week++) {
		const result = await ingestWeeklyData(LEAGUE_ID, currentYear, week, regularSeasonWeeks, cookies);
		if (result) weeksFetched++; else weeksSkipped++;
	}

	console.log(
		`[cron] season ${currentYear}: espnWeek=${espnCurrentWeek}, ` +
		`stored up to ${latestStored}, ingested ${weeksFetched} new weeks`
	);

	return json({
		ok: true,
		season: currentYear,
		espnCurrentWeek,
		lastCompletedWeek,
		latestStoredBefore: latestStored,
		weeksFetched,
		weeksSkipped,
	});
}
