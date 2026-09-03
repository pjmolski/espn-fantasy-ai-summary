import { MongoClient, ServerApiVersion } from 'mongodb';
import { runWeeklyESPN, getNFLWeek, getNFLSeason } from '$lib/utils';
import { MONGODB_URI, DB_NAME, COLLECTION_NAME, CRON_SECRET } from '$env/static/private';
import { fetchLeagueSeason, fetchWeeklyMatchups, parseSeasonData, parseWeeklyData } from '$lib/espnApi';
import { getEspnCookies } from '$lib/cookieStore';
import type { SeasonDoc, WeeklyMatchupDoc } from '$lib/schema';

// ─── MongoDB client ───────────────────────────────────────────────────────────

let cachedClient: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
	if (cachedClient) return cachedClient;
	cachedClient = new MongoClient(MONGODB_URI, {
		serverApi: {
			version: ServerApiVersion.v1,
			strict: true,
			deprecationErrors: true
		}
	});
	await cachedClient.connect();
	return cachedClient;
}

async function getDb() {
	const client = await getClient();
	return client.db(DB_NAME);
}

// Collection name constants — not sensitive, no need for env vars
const SEASONS_COLLECTION = 'seasons';
const WEEKLY_MATCHUPS_COLLECTION = 'weeklyMatchups';

// ─── Legacy types (kept for backwards compatibility) ─────────────────────────

interface WeeklyData {
	week: number;
	season: number;
	summary: {
		overallSummary: string;
		matchupSummaries: {
			team1: string;
			team2: string;
			summary: string;
			matchupId: number;
		}[];
	};
	highestScoringPlayer: {
		player: string;
		owner: string;
		score: number;
	};
	highestScoringTeam: {
		owner: string;
		score: number;
	};
	matchups: {
		matchupId: number;
		teamName: string;
		totalPoints: number;
		result: 'Win' | 'Loss';
	}[];
	standings: {
		[key: string]: string | number;
	}[];
}

interface WeeklyDataWithId extends WeeklyData {
	_id: string;
}

export interface WeekEntry {
	season: number;
	week: number;
}

// ─── Legacy read functions (AI summary collection) ───────────────────────────

export async function getLatestFantasyData(): Promise<WeeklyDataWithId | null> {
	const db = await getDb();
	const collection = db.collection(COLLECTION_NAME);

	const latestData = await collection
		.find<WeeklyDataWithId>({})
		.sort({ season: -1, week: -1 })
		.limit(1)
		.toArray();

	if (latestData.length === 0) {
		console.log('No data found in the weekly-summaries collection');
		return null;
	}

	const data = latestData[0];
	return { ...data, _id: data._id.toString() };
}

export async function getFantasyDataByWeek(
	week: number,
	season: number
): Promise<WeeklyDataWithId | null> {
	const db = await getDb();
	const collection = db.collection(COLLECTION_NAME);

	const data = await collection.findOne<WeeklyDataWithId>({ week, season });
	if (!data) return null;
	return { ...data, _id: data._id.toString() };
}

export async function getAllWeeks(): Promise<WeekEntry[]> {
	const db = await getDb();
	const collection = db.collection(COLLECTION_NAME);

	const docs = await collection
		.find<WeeklyDataWithId>({}, { projection: { week: 1, season: 1 } })
		.sort({ season: -1, week: -1 })
		.toArray();

	return docs.map((d) => ({ season: d.season ?? 0, week: d.week }));
}

export async function getRecentSummaries(limit: number = 3): Promise<string> {
	const db = await getDb();
	const collection = db.collection(COLLECTION_NAME);

	const docs = await collection
		.find<WeeklyDataWithId>(
			{},
			{ projection: { week: 1, season: 1, 'summary.overallSummary': 1 } }
		)
		.sort({ season: -1, week: -1 })
		.limit(limit)
		.toArray();

	if (docs.length === 0) return '';

	return docs
		.map((d) => `Season ${d.season}, Week ${d.week}:\n${d.summary?.overallSummary ?? '(no summary)'}`)
		.join('\n\n---\n\n');
}

export async function updateFantasyData(
	week?: number,
	season?: number
): Promise<WeeklyDataWithId | null> {
	const db = await getDb();
	const collection = db.collection(COLLECTION_NAME);
	const resolvedWeek = week ?? getNFLWeek();
	const resolvedSeason = season ?? getNFLSeason();
	const priorContext = await getRecentSummaries(3);
	console.log(`Generating new data for ${resolvedSeason} season, week ${resolvedWeek}`);
	const weeklyData = await runWeeklyESPN(resolvedWeek, resolvedSeason, priorContext);
	await collection.replaceOne(
		{ week: resolvedWeek, season: resolvedSeason },
		weeklyData,
		{ upsert: true }
	);
	console.log('New data saved to MongoDB');
	const saved = await collection.findOne<WeeklyDataWithId>({
		week: resolvedWeek,
		season: resolvedSeason
	});
	return saved ? { ...saved, _id: saved._id.toString() } : null;
}

export async function callCronUpdateFantasyData(fetch: typeof globalThis.fetch): Promise<void> {
	const response = await fetch('/api/cron/update-fantasy-data', {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${CRON_SECRET}`
		}
	});

	if (!response.ok) {
		throw new Error('Failed to update fantasy data via cron API');
	}

	console.log('Fantasy data updated successfully via cron API');
}

// ─── New ingestion functions (rich player-level data) ────────────────────────

/** Store season-level data (settings, teams, draft picks) for one year. */
export async function ingestSeasonData(
	leagueId: string,
	year: number,
	cookies?: { swid: string; espn_s2: string }
): Promise<SeasonDoc> {
	console.log(`  Fetching season data for ${year}...`);
	const raw = await fetchLeagueSeason(leagueId, year, cookies);
	const parsed = parseSeasonData(raw, leagueId, year);
	const doc: SeasonDoc = { ...parsed, capturedAt: new Date() };

	const db = await getDb();
	await db
		.collection<SeasonDoc>(SEASONS_COLLECTION)
		.replaceOne({ leagueId, seasonId: year }, doc, { upsert: true });

	console.log(`  Season ${year} stored (${doc.teams.length} teams, ${doc.draft.picks.length} draft picks)`);
	return doc;
}

/** Store one week's matchup data with full player-level rosters. */
export async function ingestWeeklyData(
	leagueId: string,
	year: number,
	week: number,
	regularSeasonWeeks: number = 14,
	cookies?: { swid: string; espn_s2: string }
): Promise<WeeklyMatchupDoc | null> {
	const raw = await fetchWeeklyMatchups(leagueId, year, week, cookies);
	const parsed = parseWeeklyData(raw, leagueId, year, week, regularSeasonWeeks);

	// Skip if ESPN returned no matchups for this week (future weeks, off-season, etc.)
	if (parsed.matchups.length === 0) {
		console.log(`    Week ${week}: no matchups found, skipping`);
		return null;
	}

	const doc: WeeklyMatchupDoc = { ...parsed, capturedAt: new Date() };

	const db = await getDb();
	await db
		.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
		.replaceOne({ leagueId, seasonId: year, scoringPeriodId: week }, doc, { upsert: true });

	const totalPlayers = doc.matchups.reduce(
		(sum, m) => sum + m.home.roster.length + (m.away?.roster.length ?? 0),
		0
	);
	console.log(`    Week ${week}: ${doc.matchups.length} matchups, ${totalPlayers} player entries`);
	return doc;
}

const DELAY_MS_BETWEEN_WEEKS = 250;
const DELAY_MS_BETWEEN_SEASONS = 750;

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Backfill all historical data for a league.
 *
 * Fetches every season ESPN has on record (via `previousSeasons` in the API
 * response) plus the current season, then fetches every week of each season.
 *
 * Options:
 *   startYear  — only ingest seasons >= this year (useful for re-runs)
 *   weeksOnly  — skip season docs, only ingest weekly matchup data
 *   dryRun     — log what would be done without writing to MongoDB
 */
export async function backfillLeague(
	leagueId: string,
	options: { startYear?: number; weeksOnly?: boolean; dryRun?: boolean; cookies?: { swid: string; espn_s2: string } } = {}
): Promise<{ seasons: number[]; weeksFetched: number; weeksSkipped: number }> {
	const { startYear, weeksOnly = false, dryRun = false, cookies } = options;

	// Fetch current season first to discover the full season list
	const currentYear = getNFLSeason();
	console.log(`Backfill starting. Current season: ${currentYear}`);
	const currentRaw = await fetchLeagueSeason(leagueId, currentYear, cookies);
	const previousSeasons: number[] = currentRaw.status?.previousSeasons ?? [];
	const allSeasons = [...new Set([...previousSeasons, currentYear])].sort();
	const seasonsToProcess = startYear ? allSeasons.filter((y) => y >= startYear) : allSeasons;
	console.log(`Seasons to process: ${seasonsToProcess.join(', ')}`);

	let weeksFetched = 0;
	let weeksSkipped = 0;

	for (const year of seasonsToProcess) {
		console.log(`\n── Season ${year} ──`);

		// Fetch/store season doc (also gives us regularSeasonWeeks for this year)
		let regularSeasonWeeks = 14;
		if (!weeksOnly) {
			if (dryRun) {
				console.log(`  [dry-run] Would ingest season ${year}`);
			} else {
				// For the current year we already have the raw response
				let seasonDoc: SeasonDoc;
				if (year === currentYear) {
					const parsed = parseSeasonData(currentRaw, leagueId, year);
					seasonDoc = { ...parsed, capturedAt: new Date() };
					const db = await getDb();
					await db
						.collection<SeasonDoc>(SEASONS_COLLECTION)
						.replaceOne({ leagueId, seasonId: year }, seasonDoc, { upsert: true });
					console.log(`  Season ${year} stored (reused existing fetch)`);
				} else {
					seasonDoc = await ingestSeasonData(leagueId, year, cookies);
				}
				regularSeasonWeeks = seasonDoc.settings.regularSeasonWeeks;
			}
		}

		// Determine how many weeks to attempt for this season.
		// For the current season: only up to the API's scoringPeriodId (current week).
		// For past seasons: try all 17 (ESPN will return empty for unplayed weeks).
		const maxWeek = year === currentYear
			? (currentRaw.scoringPeriodId ?? getNFLWeek())
			: 17;

		for (let week = 1; week <= maxWeek; week++) {
			if (dryRun) {
				console.log(`  [dry-run] Would ingest ${year} week ${week}`);
				weeksFetched++;
				continue;
			}

			try {
				const result = await ingestWeeklyData(leagueId, year, week, regularSeasonWeeks, cookies);
				if (result) {
					weeksFetched++;
				} else {
					weeksSkipped++;
				}
			} catch (err) {
				console.error(`    Error on ${year} week ${week}:`, err);
				weeksSkipped++;
			}

			await sleep(DELAY_MS_BETWEEN_WEEKS);
		}

		await sleep(DELAY_MS_BETWEEN_SEASONS);
	}

	console.log(`\nBackfill complete. ${weeksFetched} weeks stored, ${weeksSkipped} skipped.`);
	return { seasons: seasonsToProcess, weeksFetched, weeksSkipped };
}

// ─── New read functions (rich data) ──────────────────────────────────────────

export async function getSeasonDoc(leagueId: string, year: number): Promise<SeasonDoc | null> {
	const db = await getDb();
	return db
		.collection<SeasonDoc>(SEASONS_COLLECTION)
		.findOne({ leagueId, seasonId: year });
}

export async function getWeeklyMatchupDoc(
	leagueId: string,
	year: number,
	week: number
): Promise<WeeklyMatchupDoc | null> {
	const db = await getDb();
	return db
		.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
		.findOne({ leagueId, seasonId: year, scoringPeriodId: week });
}

/** Returns all (season, week) pairs we have data for, newest first. */
export async function getAvailableWeeks(
	leagueId: string
): Promise<Array<{ seasonId: number; scoringPeriodId: number; isPlayoff: boolean }>> {
	const db = await getDb();
	const docs = await db
		.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
		.find(
			{ leagueId },
			{ projection: { seasonId: 1, scoringPeriodId: 1, isPlayoff: 1 } }
		)
		.sort({ seasonId: -1, scoringPeriodId: -1 })
		.toArray();

	return docs.map((d) => ({
		seasonId: d.seasonId,
		scoringPeriodId: d.scoringPeriodId,
		isPlayoff: d.isPlayoff
	}));
}

/** Returns all season docs for a league, newest first. */
export async function getAllSeasons(leagueId: string): Promise<SeasonDoc[]> {
	const db = await getDb();
	return db
		.collection<SeasonDoc>(SEASONS_COLLECTION)
		.find({ leagueId })
		.sort({ seasonId: -1 })
		.toArray();
}

/** Cumulative totalPoints per team for a season up to (not including) the given week. */
export async function getCumulativeScoresByWeek(
	leagueId: string,
	seasonId: number,
	upToWeek: number
): Promise<Map<number, number>> {
	const db = await getDb();
	const docs = await db
		.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
		.find({ leagueId, seasonId, scoringPeriodId: { $lt: upToWeek } })
		.toArray();

	const scores = new Map<number, number>();
	for (const doc of docs) {
		for (const m of doc.matchups) {
			scores.set(m.home.teamId, (scores.get(m.home.teamId) ?? 0) + m.home.totalPoints);
			if (m.away) scores.set(m.away.teamId, (scores.get(m.away.teamId) ?? 0) + m.away.totalPoints);
		}
	}
	return scores;
}

/** All weekly matchup docs for a season up to and including the given week. */
export async function getAllWeeklyDocs(
	leagueId: string,
	seasonId: number,
	upToWeek: number
): Promise<WeeklyMatchupDoc[]> {
	const db = await getDb();
	return db
		.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
		.find({ leagueId, seasonId, scoringPeriodId: { $lte: upToWeek } })
		.sort({ scoringPeriodId: 1 })
		.toArray();
}

/** All weekly matchup docs for an entire season (no week limit). Used for standings history and bracket. */
export async function getAllSeasonDocs(
	leagueId: string,
	seasonId: number
): Promise<WeeklyMatchupDoc[]> {
	const db = await getDb();
	return db
		.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
		.find({ leagueId, seasonId })
		.sort({ scoringPeriodId: 1 })
		.toArray();
}

/** H2H record for a pair of teams across all seasons/weeks. */
export interface H2HRecord {
	team1Wins: number;
	team2Wins: number;
	ties: number;
}

/**
 * Compute all-time head-to-head records across every stored week.
 * Returns a Map keyed by "lowerId-higherId" → { team1Wins, team2Wins, ties }
 * where team1 is always the lower teamId.
 */
export async function computeAllTimeH2H(leagueId: string): Promise<Map<string, H2HRecord>> {
	const db  = await getDb();
	const all = await db
		.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
		.find({ leagueId })
		.toArray();

	const records = new Map<string, H2HRecord>();

	for (const doc of all) {
		for (const matchup of doc.matchups) {
			const { home, away, winner } = matchup;
			if (!away) continue; // bye week
			if (winner === 'UNDECIDED') continue;

			const lo = Math.min(home.teamId, away.teamId);
			const hi = Math.max(home.teamId, away.teamId);
			const key = `${lo}-${hi}`;

			if (!records.has(key)) records.set(key, { team1Wins: 0, team2Wins: 0, ties: 0 });
			const rec = records.get(key)!;

			if (winner === 'TIE') {
				rec.ties++;
			} else {
				const winnerId = winner.toLowerCase() === 'home' ? home.teamId : away.teamId;
				if (winnerId === lo) rec.team1Wins++; else rec.team2Wins++;
			}
		}
	}

	return records;
}

/** Look up H2H record between two specific teams (order doesn't matter). */
export function getH2H(
	records: Map<string, H2HRecord>,
	teamAId: number,
	teamBId: number
): { aWins: number; bWins: number; ties: number } {
	const lo  = Math.min(teamAId, teamBId);
	const hi  = Math.max(teamAId, teamBId);
	const rec = records.get(`${lo}-${hi}`) ?? { team1Wins: 0, team2Wins: 0, ties: 0 };
	const aWins = teamAId === lo ? rec.team1Wins : rec.team2Wins;
	const bWins = teamAId === lo ? rec.team2Wins : rec.team1Wins;
	return { aWins, bWins, ties: rec.ties };
}

/** Fetch every weekly matchup doc across all seasons for a league. */
export async function getAllMatchupsAllSeasons(leagueId: string): Promise<WeeklyMatchupDoc[]> {
	const db = await getDb();
	return db
		.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
		.find({ leagueId })
		.sort({ seasonId: 1, scoringPeriodId: 1 })
		.toArray();
}

/**
 * Checks if ESPN's current scoring period is ahead of our newest stored week.
 * If so, returns info about that upcoming (preview) week; otherwise null.
 */
export async function detectPreviewWeek(
	leagueId: string
): Promise<{ seasonId: number; scoringPeriodId: number; isPlayoff: boolean } | null> {
	try {
		const currentYear = getNFLSeason();
		const [cookies, db] = await Promise.all([getEspnCookies(), getDb()]);
		const cookieArg = cookies ? { swid: cookies.swid, espn_s2: cookies.espn_s2 } : undefined;
		const raw = await fetchLeagueSeason(leagueId, currentYear, cookieArg);
		const espnCurrentWeek: number = raw.scoringPeriodId ?? 0;
		if (!espnCurrentWeek) return null;

		const latest = await db
			.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
			.findOne(
				{ leagueId, seasonId: currentYear },
				{ sort: { scoringPeriodId: -1 }, projection: { scoringPeriodId: 1 } }
			);

		const latestStoredWeek = latest?.scoringPeriodId ?? 0;
		if (espnCurrentWeek <= latestStoredWeek) return null;

		const seasonDoc = await db
			.collection<SeasonDoc>(SEASONS_COLLECTION)
			.findOne(
				{ leagueId, seasonId: currentYear },
				{ projection: { 'settings.regularSeasonWeeks': 1 } }
			);
		const regularSeasonWeeks = seasonDoc?.settings?.regularSeasonWeeks ?? 14;

		return {
			seasonId: currentYear,
			scoringPeriodId: espnCurrentWeek,
			isPlayoff: espnCurrentWeek > regularSeasonWeeks,
		};
	} catch (err) {
		console.warn('[detectPreviewWeek] Failed:', err);
		return null;
	}
}

/** Per-team, per-week historical W/L across all stored seasons. */
export async function getWeekPerformance(leagueId: string): Promise<{
	perf: Record<number, Record<number, { wins: number; losses: number }>>;
	currentTeams: { teamId: number; teamName: string }[];
}> {
	const db = await getDb();

	// Find latest stored season for canonical team names
	const latestSeason = await db
		.collection<SeasonDoc>(SEASONS_COLLECTION)
		.findOne({ leagueId }, { sort: { seasonId: -1 }, projection: { seasonId: 1, teams: 1 } });

	const currentTeams: { teamId: number; teamName: string }[] =
		(latestSeason?.teams ?? []).map((t) => ({ teamId: t.teamId, teamName: t.name }));

	// Pull all matchup docs (all seasons)
	const allDocs = await db
		.collection<WeeklyMatchupDoc>(WEEKLY_MATCHUPS_COLLECTION)
		.find({ leagueId })
		.project({ scoringPeriodId: 1, matchups: 1 })
		.toArray();

	const perf: Record<number, Record<number, { wins: number; losses: number }>> = {};

	for (const doc of allDocs) {
		const week = doc.scoringPeriodId;
		for (const m of doc.matchups) {
			if (!m.away) continue; // playoff bye — no result
			const homeId = m.home.teamId;
			const awayId = m.away.teamId;
			perf[homeId] ??= {};
			perf[awayId] ??= {};
			perf[homeId][week] ??= { wins: 0, losses: 0 };
			perf[awayId][week] ??= { wins: 0, losses: 0 };
			if (m.winner === 'HOME') {
				perf[homeId][week].wins++;
				perf[awayId][week].losses++;
			} else if (m.winner === 'AWAY') {
				perf[homeId][week].losses++;
				perf[awayId][week].wins++;
			}
			// TIE / UNDECIDED: skip (no W or L)
		}
	}

	return { perf, currentTeams };
}
