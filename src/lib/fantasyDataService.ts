import { MongoClient, ServerApiVersion } from 'mongodb';
import { runWeeklyESPN, getNFLWeek, getNFLSeason } from '$lib/utils';
import { MONGODB_URI, DB_NAME, COLLECTION_NAME, CRON_SECRET } from '$env/static/private';

let cachedClient: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
	if (cachedClient) {
		return cachedClient;
	}
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

export async function getLatestFantasyData(): Promise<WeeklyDataWithId | null> {
	const client = await getClient();
	const db = client.db(DB_NAME);
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
	const client = await getClient();
	const db = client.db(DB_NAME);
	const collection = db.collection(COLLECTION_NAME);

	const data = await collection.findOne<WeeklyDataWithId>({ week, season });
	if (!data) return null;
	return { ...data, _id: data._id.toString() };
}

export async function getAllWeeks(): Promise<WeekEntry[]> {
	const client = await getClient();
	const db = client.db(DB_NAME);
	const collection = db.collection(COLLECTION_NAME);

	const docs = await collection
		.find<WeeklyDataWithId>({}, { projection: { week: 1, season: 1 } })
		.sort({ season: -1, week: -1 })
		.toArray();

	return docs.map((d) => ({ season: d.season ?? 0, week: d.week }));
}

export async function getRecentSummaries(limit: number = 3): Promise<string> {
  const client = await getClient();
  const db = client.db(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection
    .find<WeeklyDataWithId>({}, { projection: { week: 1, season: 1, 'summary.overallSummary': 1 } })
    .sort({ season: -1, week: -1 })
    .limit(limit)
    .toArray();

  if (docs.length === 0) return '';

  return docs
    .map(d => `Season ${d.season}, Week ${d.week}:\n${d.summary?.overallSummary ?? '(no summary)'}`)
    .join('\n\n---\n\n');
}

export async function updateFantasyData(
  week?: number,
  season?: number
): Promise<WeeklyDataWithId | null> {
  const client = await getClient();
  const db = client.db(DB_NAME);
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
  const saved = await collection.findOne<WeeklyDataWithId>({ week: resolvedWeek, season: resolvedSeason });
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
