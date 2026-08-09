import { MongoClient, ServerApiVersion } from 'mongodb';
import { MONGODB_URI, DB_NAME } from '$env/static/private';

let cachedClient: MongoClient | null = null;

async function getClient(): Promise<MongoClient> {
	if (cachedClient) return cachedClient;
	cachedClient = new MongoClient(MONGODB_URI, {
		serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
	});
	await cachedClient.connect();
	return cachedClient;
}

async function getDb() {
	const client = await getClient();
	return client.db(DB_NAME);
}

const COOKIES_COLLECTION = 'espn_cookies';
const TRADES_COLLECTION  = 'trades';

export interface EspnCookies {
	swid:      string;
	espn_s2:   string;
	updatedAt: Date;
}

// ─── Cookie read/write ────────────────────────────────────────────────────────

export async function getEspnCookies(): Promise<EspnCookies | null> {
	const db   = await getDb();
	const doc  = await db.collection(COOKIES_COLLECTION).findOne({});
	if (!doc) return null;
	return { swid: doc.swid, espn_s2: doc.espn_s2, updatedAt: doc.updatedAt };
}

export async function setEspnCookies(swid: string, espn_s2: string): Promise<void> {
	const db = await getDb();
	await db.collection(COOKIES_COLLECTION).updateOne(
		{},
		{ $set: { swid, espn_s2, updatedAt: new Date() } },
		{ upsert: true }
	);
}

// ─── Trade upsert/read ────────────────────────────────────────────────────────

export interface TradeDoc {
	tradeKey:       string; // dedup key
	processDate:    string;
	seasonId:       number;
	scoringPeriodId: number | null;
	team1Id:        number;
	team2Id:        number;
	team1Name:      string;
	team2Name:      string;
	team1Received:  { playerId: number; playerName: string; position: string }[];
	team2Received:  { playerId: number; playerName: string; position: string }[];
}

export async function upsertTrades(trades: TradeDoc[]): Promise<number> {
	if (trades.length === 0) return 0;
	const db  = await getDb();
	const col = db.collection(TRADES_COLLECTION);
	let added = 0;
	for (const trade of trades) {
		const result = await col.updateOne(
			{ tradeKey: trade.tradeKey },
			{ $setOnInsert: trade },
			{ upsert: true }
		);
		if (result.upsertedCount > 0) added++;
	}
	return added;
}

export async function getTradesBetweenTeams(
	team1Id: number,
	team2Id: number
): Promise<TradeDoc[]> {
	const db  = await getDb();
	const col = db.collection<TradeDoc>(TRADES_COLLECTION);
	return col
		.find({
			$or: [
				{ team1Id, team2Id },
				{ team1Id: team2Id, team2Id: team1Id }
			]
		})
		.sort({ processDate: -1 })
		.toArray();
}

export async function getLastSyncTime(): Promise<Date | null> {
	const db  = await getDb();
	const doc = await db.collection(COOKIES_COLLECTION).findOne({});
	return doc?.lastTradeSync ?? null;
}

export async function setLastSyncTime(): Promise<void> {
	const db = await getDb();
	await db.collection(COOKIES_COLLECTION).updateOne(
		{},
		{ $set: { lastTradeSync: new Date() } }
	);
}
