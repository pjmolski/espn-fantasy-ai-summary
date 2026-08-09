import fetch from 'node-fetch';
import type {
	SeasonDoc,
	WeeklyMatchupDoc,
	PlayerEntry,
	TeamMatchupData,
	MatchupEntry
} from './schema';

const BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';

const ESPN_HEADERS = {
	Accept: 'application/json, text/plain, */*',
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.130 Safari/537.36',
	Connection: 'keep-alive'
};

// Lineup slot IDs that count as starting spots
const STARTER_SLOTS = new Set([0, 2, 4, 6, 16, 17, 23]);

// ─── Raw ESPN fetchers ────────────────────────────────────────────────────────

async function espnGet(url: string): Promise<any> {
	const res = await fetch(url, { headers: ESPN_HEADERS });
	if (!res.ok) throw new Error(`ESPN API ${res.status} for ${url}`);
	return res.json();
}

export async function fetchLeagueSeason(leagueId: string, year: number): Promise<any> {
	const url = `${BASE_URL}/seasons/${year}/segments/0/leagues/${leagueId}?view=mSettings&view=mTeam&view=mDraftDetail`;
	return espnGet(url);
}

export async function fetchWeeklyMatchups(
	leagueId: string,
	year: number,
	week: number
): Promise<any> {
	const url = `${BASE_URL}/seasons/${year}/segments/0/leagues/${leagueId}?view=mMatchup&view=mMatchupScore&scoringPeriodId=${week}`;
	return espnGet(url);
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parsePlayerEntry(entry: any, week: number): PlayerEntry {
	const poolEntry = entry.playerPoolEntry;
	const player = poolEntry?.player;
	const stats: any[] = player?.stats ?? [];

	// Match stats to the requested week; fall back to any entry if scoringPeriodId doesn't match
	const actual =
		stats.find((s) => s.statSourceId === 0 && s.scoringPeriodId === week) ??
		stats.find((s) => s.statSourceId === 0);
	const projected =
		stats.find((s) => s.statSourceId === 1 && s.scoringPeriodId === week) ??
		stats.find((s) => s.statSourceId === 1);

	return {
		playerId: entry.playerId,
		fullName: player?.fullName ?? 'Unknown',
		defaultPositionId: player?.defaultPositionId ?? 0,
		lineupSlotId: entry.lineupSlotId,
		isStarter: STARTER_SLOTS.has(entry.lineupSlotId),
		actualScore: poolEntry?.appliedStatTotal ?? actual?.appliedTotal ?? 0,
		projectedScore: projected?.appliedTotal ?? 0,
		projectedCeiling: projected?.appliedTotalCeiling ?? 0,
		proTeamId: player?.proTeamId ?? 0,
		injuryStatus: player?.injuryStatus ?? 'ACTIVE',
		acquisitionType: entry.acquisitionType ?? 'UNKNOWN',
		acquisitionDate: entry.acquisitionDate ?? undefined,
		appliedStats: actual?.appliedStats ?? {}
	};
}

function parseTeamSide(side: any, week: number): TeamMatchupData {
	const entries: any[] = side.rosterForCurrentScoringPeriod?.entries ?? [];
	return {
		teamId: side.teamId,
		totalPoints: side.totalPoints ?? 0,
		roster: entries.map((e) => parsePlayerEntry(e, week))
	};
}

export function parseSeasonData(
	raw: any,
	leagueId: string,
	year: number
): Omit<SeasonDoc, 'capturedAt'> {
	const settings = raw.settings ?? {};
	const members: any[] = raw.members ?? [];

	// Build memberId → displayName map for owner resolution
	const memberMap = new Map<string, string>(
		members.map((m) => [m.id, m.displayName ?? `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()])
	);

	const teams = (raw.teams ?? []).map((t: any) => ({
		teamId: t.id,
		name: t.name?.trim() ?? '',
		abbreviation: t.abbrev ?? '',
		owners: (t.owners ?? []).map((id: string) => memberMap.get(id) ?? id),
		logoUrl: t.logo ?? undefined
	}));

	const picks = (raw.draftDetail?.picks ?? []).map((p: any) => ({
		round: p.roundId,
		roundPick: p.roundPickNumber,
		overallPick: p.overallPickNumber,
		teamId: p.teamId,
		playerId: p.playerId,
		isKeeper: p.keeper ?? false
	}));

	return {
		leagueId,
		seasonId: year,
		leagueName: settings.name ?? '',
		teamCount: raw.size ?? 0,
		settings: {
			scoringType: settings.scoringSettings?.scoringType ?? 'H2H_POINTS',
			scoringItems: (settings.scoringSettings?.scoringItems ?? [])
				.filter((s: any) => s.points !== 0)
				.map((s: any) => ({ statId: s.statId, points: s.points })),
			lineupSlotCounts: settings.rosterSettings?.lineupSlotCounts ?? {},
			playoffTeamCount: settings.scheduleSettings?.playoffTeamCount ?? 6,
			regularSeasonWeeks: settings.scheduleSettings?.matchupPeriodCount ?? 14,
			acquisitionBudget: settings.acquisitionSettings?.acquisitionBudget ?? 200
		},
		teams,
		draft: {
			type: settings.draftSettings?.type ?? 'UNKNOWN',
			date: settings.draftSettings?.date ?? undefined,
			picks
		}
	};
}

export function parseWeeklyData(
	raw: any,
	leagueId: string,
	year: number,
	week: number,
	regularSeasonWeeks: number
): Omit<WeeklyMatchupDoc, 'capturedAt'> {
	const weekMatchups: any[] = (raw.schedule ?? []).filter(
		(m: any) => m.matchupPeriodId === week
	);

	const matchups: MatchupEntry[] = weekMatchups.map((m) => ({
		matchupId: m.id,
		matchupPeriodId: m.matchupPeriodId,
		winner: m.winner ?? 'UNDECIDED',
		playoffTierType: m.playoffTierType ?? 'NONE',
		home: m.home ? parseTeamSide(m.home, week) : { teamId: 0, totalPoints: 0, roster: [] },
		away: m.away ? parseTeamSide(m.away, week) : undefined
	}));

	return {
		leagueId,
		seasonId: year,
		scoringPeriodId: week,
		isPlayoff: week > regularSeasonWeeks,
		matchups
	};
}

export async function fetchTransactions(
	leagueId: string,
	year: number,
	swid: string,
	espnS2: string
): Promise<{ data: any; newEspnS2: string | null }> {
	const cookie = `SWID=${swid}; espn_s2=${espnS2}`;

	const extractCookie = (res: any): string | null => {
		const sc = res.headers.get('set-cookie') ?? '';
		const m  = sc.match(/espn_s2=([^;]+)/);
		return m ? decodeURIComponent(m[1]) : null;
	};

	// Communication endpoint — correct domain for trade/transaction history
	const COMM_BASE = 'https://lm-api-communication.fantasy.espn.com/apis/v3/games/ffl';
	const commUrl   = `${COMM_BASE}/seasons/${year}/segments/0/leagues/${leagueId}/communication/?view=kona_league_communication`;
	const commRes   = await fetch(commUrl, { headers: { ...ESPN_HEADERS, Cookie: cookie } });
	const commText  = await commRes.text();
	console.log(`[fetchTransactions] ${year} communication status=${commRes.status} body=${commText.slice(0, 500)}`);

	const newEspnS2 = extractCookie(commRes);

	if (commRes.ok && commText.trim().length > 0) {
		const commData = JSON.parse(commText);
		// Log top-level keys so we can find where trades live
		console.log(`[fetchTransactions] ${year} keys:`, Object.keys(commData).join(', '));
		const txns = commData?.transactions ?? commData?.items ?? commData?.topics ?? commData ?? [];
		const arr  = Array.isArray(txns) ? txns : [];
		console.log(`[fetchTransactions] ${year} found ${arr.length} items, types: ${[...new Set(arr.map((t: any) => t.type ?? t.topicType))].join(',') || 'none'}`);
		return { data: arr, newEspnS2 };
	}

	return { data: [], newEspnS2 };
}
