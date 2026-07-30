import type { WeeklyMatchupDoc, SeasonDoc } from './schema';
import type { PlayoffBracketState } from './playoffBracket';

export interface StandingsEntry {
	teamId: number;
	teamName: string;
	logoUrl?: string;
	weeklyRanks: Array<{ week: number; rank: number }>;
}

/**
 * Compute per-week rank history for all teams in a season.
 *
 * Regular season: rank by W-L, tiebreak by cumulative points.
 * Playoff weeks (assumes 12-team / 6-playoff-team format):
 *   Seeds 1-6 = winners bracket (standard ESPN)
 *   Seeds 7-12 = losers bracket (custom Chumpionship logic)
 *   Uses range-narrowing to produce a projected rank (midpoint of possible range).
 */
export function computeStandingsHistory(
	docs: WeeklyMatchupDoc[],
	seasonDoc: SeasonDoc,
	bracket?: PlayoffBracketState
): StandingsEntry[] {
	const totalTeams = seasonDoc.teamCount;
	const teamIds = seasonDoc.teams.map((t) => t.teamId);
	const sorted = [...docs].sort((a, b) => a.scoringPeriodId - b.scoringPeriodId);

	// weeklyRanks[teamId] = array of ranks, index = week number (0 = pre-season)
	const weeklyRanks = new Map<number, number[]>();
	for (const id of teamIds) weeklyRanks.set(id, [totalTeams]); // week 0: all at bottom

	const wins = new Map<number, number>();
	const pts = new Map<number, number>();
	for (const id of teamIds) {
		wins.set(id, 0);
		pts.set(id, 0);
	}

	const regularDocs = sorted.filter((d) => !d.isPlayoff);
	const playoffDocs = sorted.filter((d) => d.isPlayoff);

	// ── Regular season ─────────────────────────────────────────────────────────
	for (const doc of regularDocs) {
		for (const m of doc.matchups) {
			pts.set(m.home.teamId, (pts.get(m.home.teamId) ?? 0) + m.home.totalPoints);
			if (m.away) {
				pts.set(m.away.teamId, (pts.get(m.away.teamId) ?? 0) + m.away.totalPoints);
				if (m.winner === 'HOME') wins.set(m.home.teamId, (wins.get(m.home.teamId) ?? 0) + 1);
				else if (m.winner === 'AWAY') wins.set(m.away.teamId, (wins.get(m.away.teamId) ?? 0) + 1);
			}
		}
		const ranked = [...teamIds].sort((a, b) => {
			const wd = (wins.get(b) ?? 0) - (wins.get(a) ?? 0);
			return wd !== 0 ? wd : (pts.get(b) ?? 0) - (pts.get(a) ?? 0);
		});
		ranked.forEach((id, i) => weeklyRanks.get(id)!.push(i + 1));
	}

	// ── Playoffs ───────────────────────────────────────────────────────────────
	if (playoffDocs.length > 0) {
		// Use playoffTierType from the first playoff week to assign brackets correctly.
		// This avoids relying on our computed regular-season rank which may differ from ESPN's seeding.
		const winnersBracketTeams = new Set<number>();
		const losersBracketTeams = new Set<number>();
		const firstPlayoffDoc = playoffDocs[0];
		for (const m of firstPlayoffDoc.matchups) {
			const isWinners = m.playoffTierType === 'WINNERS_BRACKET';
			const isLosers = !isWinners && m.playoffTierType !== 'NONE';
			if (isWinners) {
				winnersBracketTeams.add(m.home.teamId);
				if (m.away) winnersBracketTeams.add(m.away.teamId);
			} else if (isLosers) {
				losersBracketTeams.add(m.home.teamId);
				if (m.away) losersBracketTeams.add(m.away.teamId);
			}
		}
		// Any team not yet classified must have a bye — fall back to computed seed
		const seeds = new Map<number, number>();
		for (const id of teamIds) {
			const ranks = weeklyRanks.get(id)!;
			seeds.set(id, ranks[ranks.length - 1]);
		}
		for (const id of teamIds) {
			if (!winnersBracketTeams.has(id) && !losersBracketTeams.has(id)) {
				const seed = seeds.get(id) ?? 1;
				if (seed <= 6) winnersBracketTeams.add(id);
				else losersBracketTeams.add(id);
			}
		}

		// Possible final rank range [lo, hi] for each team.
		const lo = new Map<number, number>();
		const hi = new Map<number, number>();
		for (const id of teamIds) {
			lo.set(id, winnersBracketTeams.has(id) ? 1 : 7);
			hi.set(id, winnersBracketTeams.has(id) ? 6 : 12);
		}

		for (const doc of playoffDocs) {
			const bracketRound = bracket?.rounds.find((r) => r.week === doc.scoringPeriodId);

			if (bracketRound) {
				// Use custom bracket results (correct losers-bracket pairings)
				const playedThisRound = new Set<number>();

				for (const bm of bracketRound.matchups) {
					if (!bm.teamIdB || !bm.winner) continue;
					const loserId = bm.winner === bm.teamIdA ? bm.teamIdB : bm.teamIdA;
					narrowRange(bm.winner, true, lo, hi);
					narrowRange(loserId, false, lo, hi);
					playedThisRound.add(bm.teamIdA);
					playedThisRound.add(bm.teamIdB);
				}

				// Vacation teams are treated as byes (wins that don't narrow further)
				for (const id of bracketRound.onVacation) {
					narrowRange(id, true, lo, hi);
				}

				// TBD matchups (prior round incomplete) — don't narrow
			} else {
				// Fall back to ESPN matchup data
				const playedThisRound = new Set<number>();

				for (const m of doc.matchups) {
					if (!m.away) continue;
					playedThisRound.add(m.home.teamId);
					playedThisRound.add(m.away.teamId);
					if (m.winner === 'UNDECIDED') continue;
					const winnerId = m.winner === 'HOME' ? m.home.teamId : m.away.teamId;
					const loserId = m.winner === 'HOME' ? m.away.teamId : m.home.teamId;
					narrowRange(winnerId, true, lo, hi);
					narrowRange(loserId, false, lo, hi);
				}

				for (const id of teamIds) {
					if (!playedThisRound.has(id)) narrowRange(id, true, lo, hi);
				}
			}

			// Emit midpoint rank for each team
			for (const id of teamIds) {
				const rank = ((lo.get(id) ?? 1) + (hi.get(id) ?? totalTeams)) / 2;
				weeklyRanks.get(id)!.push(rank);
			}
		}
	}

	return seasonDoc.teams.map((t) => ({
		teamId: t.teamId,
		teamName: t.name,
		logoUrl: t.logoUrl,
		weeklyRanks: (weeklyRanks.get(t.teamId) ?? []).map((rank, week) => ({ week, rank }))
	}));
}

/**
 * Narrow a team's possible-rank range based on a win or loss.
 * Range transitions are hardcoded for the 12-team bracket format.
 */
function narrowRange(
	id: number,
	won: boolean,
	lo: Map<number, number>,
	hi: Map<number, number>
): void {
	const l = lo.get(id) ?? 1;
	const h = hi.get(id) ?? 12;

	// Winners bracket
	if (l === 1 && h === 6) {
		// Round 1: initial state → winner or bye advances, loser drops to 5/6 game
		if (won) { lo.set(id, 1); hi.set(id, 4); }
		else { lo.set(id, 5); hi.set(id, 6); }
	} else if (l === 1 && h === 4) {
		// Round 2: semifinal → winner to championship, loser to 3rd-place game
		if (won) { lo.set(id, 1); hi.set(id, 2); }
		else { lo.set(id, 3); hi.set(id, 4); }
	} else if (l === 5 && h === 6) {
		// Round 2 consolation: 5th/6th determined
		if (won) { lo.set(id, 5); hi.set(id, 5); }
		else { lo.set(id, 6); hi.set(id, 6); }
	} else if (l === 1 && h === 2) {
		// Round 3 championship
		if (won) { lo.set(id, 1); hi.set(id, 1); }
		else { lo.set(id, 2); hi.set(id, 2); }
	} else if (l === 3 && h === 4) {
		// Round 3 third-place game
		if (won) { lo.set(id, 3); hi.set(id, 3); }
		else { lo.set(id, 4); hi.set(id, 4); }
	}
	// Losers bracket (Chumpionship)
	else if (l === 7 && h === 12) {
		// Round 1: initial state → winners advance, losers go to 11/12 game
		if (won) { lo.set(id, 7); hi.set(id, 10); }
		else { lo.set(id, 11); hi.set(id, 12); }
	} else if (l === 7 && h === 10) {
		// Round 2: main game → winners to 7/8 game, losers to 9/10 game
		if (won) { lo.set(id, 7); hi.set(id, 8); }
		else { lo.set(id, 9); hi.set(id, 10); }
	} else if (l === 11 && h === 12) {
		// Round 2: 11/12 consolation → determined
		if (won) { lo.set(id, 11); hi.set(id, 11); }
		else { lo.set(id, 12); hi.set(id, 12); }
	} else if (l === 7 && h === 8) {
		// Round 3: Chumpionship → 7th/8th determined
		if (won) { lo.set(id, 7); hi.set(id, 7); }
		else { lo.set(id, 8); hi.set(id, 8); }
	} else if (l === 9 && h === 10) {
		// Round 3: 9th/10th game
		if (won) { lo.set(id, 9); hi.set(id, 9); }
		else { lo.set(id, 10); hi.set(id, 10); }
	}
	// If range is already a single value (determined), do nothing
}

/** Compute each team's current win/loss streak from all docs in the season. */
export function computeStreaks(
	docs: WeeklyMatchupDoc[]
): Map<number, { type: 'W' | 'L'; count: number }> {
	const sorted = [...docs]
		.filter((d) => !d.isPlayoff)
		.sort((a, b) => a.scoringPeriodId - b.scoringPeriodId);

	const history = new Map<number, Array<'W' | 'L'>>();

	for (const doc of sorted) {
		for (const m of doc.matchups) {
			if (m.winner !== 'HOME' && m.winner !== 'AWAY') continue;
			if (!m.away) continue;
			const homeWon = m.winner === 'HOME';
			for (const [id, won] of [[m.home.teamId, homeWon], [m.away.teamId, !homeWon]] as [number, boolean][]) {
				if (!history.has(id)) history.set(id, []);
				history.get(id)!.push(won ? 'W' : 'L');
			}
		}
	}

	const streaks = new Map<number, { type: 'W' | 'L'; count: number }>();
	for (const [id, results] of history.entries()) {
		if (!results.length) continue;
		const last = results[results.length - 1];
		let count = 0;
		for (let i = results.length - 1; i >= 0 && results[i] === last; i--) count++;
		streaks.set(id, { type: last, count });
	}
	return streaks;
}
