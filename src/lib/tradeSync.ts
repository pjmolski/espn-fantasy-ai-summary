import { fetchTransactions } from '$lib/espnApi';
import { getEspnCookies, setEspnCookies, upsertTrades, setLastSyncTime } from '$lib/cookieStore';
import { getAllSeasons } from '$lib/fantasyDataService';
import { LEAGUE_ID } from '$env/static/private';

const POSITION: Record<number, string> = {
	1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST'
};

export async function syncTrades(): Promise<{ added: number; error?: string }> {
	const cookies = await getEspnCookies();
	if (!cookies) return { added: 0, error: 'No ESPN cookies stored. POST /api/admin/update-cookies first.' };

	const seasons = await getAllSeasons(LEAGUE_ID);
	let totalAdded = 0;
	let currentEspnS2 = cookies.espn_s2;

	for (const season of seasons) {
		try {
			const { data, newEspnS2 } = await fetchTransactions(
				LEAGUE_ID,
				season.seasonId,
				cookies.swid,
				currentEspnS2
			);

			// Persist rotated cookie immediately so it's never lost
			if (newEspnS2 && newEspnS2 !== currentEspnS2) {
				currentEspnS2 = newEspnS2;
				await setEspnCookies(cookies.swid, currentEspnS2);
				console.log(`[tradeSync] espn_s2 rotated for season ${season.seasonId}`);
			}

			const transactions: any[] = Array.isArray(data) ? data : (data?.transactions ?? data?.items ?? []);

			const teamNames = new Map<number, string>(
				season.teams.map((t) => [t.teamId, t.name])
			);

			const trades = [];
			for (const tx of transactions) {
				if (tx.type !== 'TRADE_ACCEPT') continue;
				if (tx.status && tx.status !== 'EXECUTED') continue;

				const items: any[] = tx.items ?? [];
				const fromTeams = new Set(items.map((i: any) => i.fromTeamId));
				const toTeams   = new Set(items.map((i: any) => i.toTeamId));
				const involved  = [...new Set([...fromTeams, ...toTeams])].sort((a, b) => a - b);
				if (involved.length < 2) continue;

				const [t1, t2] = involved;
				const received: Record<number, { playerId: number; playerName: string; position: string }[]> = {};
				for (const id of involved) received[id] = [];

				for (const item of items) {
					const to = item.toTeamId;
					if (!(to in received)) continue;
					const player = item.playerPoolEntry?.player;
					received[to].push({
						playerId: item.playerId,
						playerName: player?.fullName ?? `Player ${item.playerId}`,
						position: POSITION[player?.defaultPositionId ?? 0] ?? '?'
					});
				}

				// Stable dedup key: sorted teamIds + processDate
				const tradeKey = `${season.seasonId}-${t1}-${t2}-${tx.processDate ?? tx.id}`;

				trades.push({
					tradeKey,
					processDate: new Date(tx.processDate).toISOString(),
					seasonId: season.seasonId,
					scoringPeriodId: tx.scoringPeriodId ?? null,
					team1Id: t1,
					team2Id: t2,
					team1Name: teamNames.get(t1) ?? `Team ${t1}`,
					team2Name: teamNames.get(t2) ?? `Team ${t2}`,
					team1Received: received[t1],
					team2Received: received[t2]
				});
			}

			const added = await upsertTrades(trades);
			totalAdded += added;
			console.log(`[tradeSync] season ${season.seasonId}: ${transactions.length} txns, ${trades.length} trades, ${added} new`);
		} catch (e) {
			console.warn(`[tradeSync] season ${season.seasonId} failed:`, e);
		}
	}

	await setLastSyncTime();
	return { added: totalAdded };
}
