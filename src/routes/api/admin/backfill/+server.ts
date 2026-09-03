import { json } from '@sveltejs/kit';
import { CRON_SECRET, LEAGUE_ID } from '$env/static/private';
import { backfillLeague, ingestSeasonData, ingestWeeklyData } from '$lib/fantasyDataService';
import { getEspnCookies } from '$lib/cookieStore';

/**
 * Admin endpoint to trigger historical data backfill.
 *
 * Protected by the same CRON_SECRET used for the weekly update cron.
 *
 * Query params:
 *   startYear  — only process seasons >= this year (default: all)
 *   weeksOnly  — skip season docs, re-fetch only weekly data (default: false)
 *   dryRun     — log plan without writing to DB (default: false)
 *   year       — ingest a single season doc only (skip weekly)
 *   week       — combined with year: ingest one specific week
 *
 * Examples:
 *   GET /api/admin/backfill                          → full backfill all seasons
 *   GET /api/admin/backfill?startYear=2022           → 2022 onwards only
 *   GET /api/admin/backfill?year=2023&week=7         → single week re-ingest
 *   GET /api/admin/backfill?dryRun=true              → preview without writes
 */
export async function GET({ request, url }) {
	const authHeader = request.headers.get('authorization');
	if (authHeader !== `Bearer ${CRON_SECRET}`) {
		return new Response('Unauthorized', { status: 401 });
	}

	const leagueId = LEAGUE_ID;
	const cookies = await getEspnCookies().then(c => c ? { swid: c.swid, espn_s2: c.espn_s2 } : undefined);
	const dryRun = url.searchParams.get('dryRun') === 'true';
	const weeksOnly = url.searchParams.get('weeksOnly') === 'true';
	const startYearParam = url.searchParams.get('startYear');
	const startYear = startYearParam ? parseInt(startYearParam) : undefined;

	// Single-season or single-week re-ingest
	const yearParam = url.searchParams.get('year');
	const weekParam = url.searchParams.get('week');

	try {
		if (yearParam && weekParam) {
			// Ingest one specific week
			const year = parseInt(yearParam);
			const week = parseInt(weekParam);
			const result = await ingestWeeklyData(leagueId, year, week, 14, cookies);
			return json({ ok: true, mode: 'single-week', year, week, stored: !!result });
		}

		if (yearParam && !weekParam) {
			// Ingest one season doc only
			const year = parseInt(yearParam);
			const result = await ingestSeasonData(leagueId, year, cookies);
			return json({ ok: true, mode: 'single-season', year, teams: result.teams.length });
		}

		// Seasons-only re-ingest (refresh team names etc without touching weekly data)
		const seasonsOnly = url.searchParams.get('seasonsOnly') === 'true';
		if (seasonsOnly) {
			const { getAllSeasons } = await import('$lib/fantasyDataService');
			const seasonDocs = await getAllSeasons(leagueId);
			const years = seasonDocs.map(d => d.seasonId).sort((a, b) => a - b);
			const filtered = startYear ? years.filter(y => y >= startYear) : years;
			const results = [];
			for (const year of filtered) {
				if (!dryRun) {
					const doc = await ingestSeasonData(leagueId, year);
					results.push({ year, teams: doc.teams.length });
				} else {
					results.push({ year, dryRun: true });
				}
			}
			return json({ ok: true, mode: 'seasons-only', seasons: results });
		}

		// Full backfill
		const result = await backfillLeague(leagueId, { startYear, weeksOnly, dryRun, cookies });
		return json({ ok: true, mode: dryRun ? 'dry-run' : 'backfill', ...result });
	} catch (error) {
		console.error('Backfill error:', error);
		return json({ error: String(error) }, { status: 500 });
	}
}
