import { json } from '@sveltejs/kit';
import { CRON_SECRET, LEAGUE_ID } from '$env/static/private';
import { backfillLeague } from '$lib/fantasyDataService';
import { getNFLSeason } from '$lib/utils';
import { getEspnCookies } from '$lib/cookieStore';

/**
 * Vercel cron endpoint — fires every Tuesday at 11am UTC (after Monday Night Football).
 * Ingests the just-completed week for the current NFL season.
 *
 * Vercel automatically sends: Authorization: Bearer <CRON_SECRET>
 * Configured in vercel.json → crons → schedule "0 11 * * 2"
 *
 * Both leagues are public — cookies are not required for ESPN data access.
 * getEspnCookies() will return null if SWID/ESPN_S2 are unset, and
 * backfillLeague handles cookies: undefined gracefully.
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

	try {
		const result = await backfillLeague(LEAGUE_ID, {
			startYear: currentYear,
			cookies,
		});

		console.log(
			`[cron] Weekly update complete — season ${currentYear}, ` +
			`${result.weeksFetched} weeks stored, ${result.weeksSkipped} skipped`
		);

		return json({
			ok: true,
			season: currentYear,
			leagueId: LEAGUE_ID,
			weeksFetched: result.weeksFetched,
			weeksSkipped: result.weeksSkipped,
		});
	} catch (error) {
		console.error('[cron] Weekly update failed:', error);
		return json({ error: String(error) }, { status: 500 });
	}
}
