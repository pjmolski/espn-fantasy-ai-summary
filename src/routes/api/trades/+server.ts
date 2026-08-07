import { json } from '@sveltejs/kit';
import { getAllSeasons } from '$lib/fantasyDataService';
import { fetchTransactions } from '$lib/espnApi';
import { LEAGUE_ID } from '$env/static/private';

const POSITION: Record<number, string> = {
	1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST'
};

export async function GET({ url }) {
	const team1 = parseInt(url.searchParams.get('team1') ?? '0');
	const team2 = parseInt(url.searchParams.get('team2') ?? '0');

	if (!team1 || !team2 || team1 === team2) {
		return json({ error: 'Select two different teams' }, { status: 400 });
	}

	const seasons = await getAllSeasons(LEAGUE_ID);
	const trades: any[] = [];

	for (const season of seasons) {
		try {
			const raw = await fetchTransactions(LEAGUE_ID, season.seasonId);
			// DEBUG — log response shape
			const isArray = Array.isArray(raw);
			console.log(`[trades] season ${season.seasonId} isArray=${isArray} sample:`, JSON.stringify(raw).slice(0, 500));
			const transactions: any[] = isArray ? raw : (raw.transactions ?? raw.items ?? []);

			const teamNames = new Map<number, string>(
				season.teams.map((t) => [t.teamId, t.name])
			);

			for (const tx of transactions) {
				// Only completed trades
				if (tx.type !== 'TRADE_ACCEPT') continue;
				if (tx.status && tx.status !== 'EXECUTED') continue;

				const items: any[] = tx.items ?? [];

				// Collect teams involved in this transaction
				const fromTeams = new Set(items.map((i: any) => i.fromTeamId));
				const toTeams   = new Set(items.map((i: any) => i.toTeamId));
				const involved  = new Set([...fromTeams, ...toTeams]);

				if (!involved.has(team1) || !involved.has(team2)) continue;

				// Build what each team received
				const received: Record<number, any[]> = { [team1]: [], [team2]: [] };
				for (const item of items) {
					const to = item.toTeamId;
					if (to !== team1 && to !== team2) continue;
					const player = item.playerPoolEntry?.player;
					received[to].push({
						playerId: item.playerId,
						playerName: player?.fullName ?? `Player ${item.playerId}`,
						position: POSITION[player?.defaultPositionId ?? 0] ?? '?'
					});
				}

				trades.push({
					processDate: new Date(tx.processDate).toISOString(),
					seasonId: season.seasonId,
					scoringPeriodId: tx.scoringPeriodId ?? null,
					team1: {
						teamId: team1,
						teamName: teamNames.get(team1) ?? `Team ${team1}`,
						received: received[team1]
					},
					team2: {
						teamId: team2,
						teamName: teamNames.get(team2) ?? `Team ${team2}`,
						received: received[team2]
					}
				});
			}
		} catch (e) {
			console.warn(`Skipping season ${season.seasonId} — transactions fetch failed:`, e);
		}
	}

	trades.sort((a, b) => b.processDate.localeCompare(a.processDate));
	return json({ trades });
}
