import { json } from '@sveltejs/kit';
import { getTradesBetweenTeams, getLastSyncTime } from '$lib/cookieStore';
import type { TradeDoc } from '$lib/cookieStore';

export async function GET({ url }) {
	const team1 = parseInt(url.searchParams.get('team1') ?? '0');
	const team2 = parseInt(url.searchParams.get('team2') ?? '0');

	if (!team1 || !team2 || team1 === team2) {
		return json({ error: 'Select two different teams' }, { status: 400 });
	}

	const rawTrades = await getTradesBetweenTeams(team1, team2);
	const lastSync  = await getLastSyncTime();

	// Normalise so team1/team2 always match the request order
	const trades = rawTrades.map((t: TradeDoc) => {
		const flipped = t.team1Id === team2;
		return {
			processDate:     t.processDate,
			seasonId:        t.seasonId,
			scoringPeriodId: t.scoringPeriodId,
			team1: {
				teamId:   team1,
				teamName: flipped ? t.team2Name : t.team1Name,
				received: flipped ? t.team2Received : t.team1Received
			},
			team2: {
				teamId:   team2,
				teamName: flipped ? t.team1Name : t.team2Name,
				received: flipped ? t.team1Received : t.team2Received
			}
		};
	});

	return json({ trades, lastSync });
}
