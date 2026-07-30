import type { WeeklyMatchupDoc, SeasonDoc } from './schema';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BracketMatchup {
	teamIdA: number;
	teamIdB: number | null; // null = prior round not yet complete
	scoreA: number | null;
	scoreB: number | null;
	winner: number | null;
	placesAtStake: [number, number];
	label: string;
}

export interface PlayoffRound {
	week: number;
	onVacation: number[]; // teamIds on bye / vacation this round
	matchups: BracketMatchup[];
}

export interface PlayoffBracketState {
	seeds: Map<number, number>;     // teamId → seed 1-12
	teamBySeed: Map<number, number>; // seed → teamId
	rounds: PlayoffRound[];
	regularSeasonWeeks: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTeamScore(doc: WeeklyMatchupDoc, teamId: number): number | null {
	for (const m of doc.matchups) {
		if (m.home.teamId === teamId) return m.home.totalPoints;
		if (m.away?.teamId === teamId) return m.away.totalPoints;
	}
	return null;
}

function bm(
	teamA: number | null,
	teamB: number | null,
	doc: WeeklyMatchupDoc | undefined,
	places: [number, number],
	label: string
): BracketMatchup {
	const scoreA = (doc && teamA) ? getTeamScore(doc, teamA) : null;
	const scoreB = (doc && teamB) ? getTeamScore(doc, teamB) : null;
	let winner: number | null = null;
	if (teamA && teamB && scoreA !== null && scoreB !== null) {
		winner = scoreA > scoreB ? teamA : teamB;
	}
	return { teamIdA: teamA, teamIdB: teamB, scoreA, scoreB, winner, placesAtStake: places, label };
}

function loser(m: BracketMatchup): number | null {
	if (!m.winner || !m.teamIdB) return null;
	return m.winner === m.teamIdA ? m.teamIdB : m.teamIdA;
}

// ─── Seed computation ─────────────────────────────────────────────────────────

export function computePlayoffSeeds(
	regularDocs: WeeklyMatchupDoc[],
	seasonDoc: SeasonDoc
): { seeds: Map<number, number>; teamBySeed: Map<number, number> } {
	const teamIds = seasonDoc.teams.map((t) => t.teamId);
	const wins = new Map<number, number>();
	const pts = new Map<number, number>();
	for (const id of teamIds) { wins.set(id, 0); pts.set(id, 0); }

	const sorted = [...regularDocs].sort((a, b) => a.scoringPeriodId - b.scoringPeriodId);
	for (const doc of sorted) {
		for (const m of doc.matchups) {
			pts.set(m.home.teamId, (pts.get(m.home.teamId) ?? 0) + m.home.totalPoints);
			if (m.away) {
				pts.set(m.away.teamId, (pts.get(m.away.teamId) ?? 0) + m.away.totalPoints);
				if (m.winner === 'HOME') wins.set(m.home.teamId, (wins.get(m.home.teamId) ?? 0) + 1);
				else if (m.winner === 'AWAY') wins.set(m.away.teamId, (wins.get(m.away.teamId) ?? 0) + 1);
			}
		}
	}

	const ranked = [...teamIds].sort((a, b) => {
		const wd = (wins.get(b) ?? 0) - (wins.get(a) ?? 0);
		return wd !== 0 ? wd : (pts.get(b) ?? 0) - (pts.get(a) ?? 0);
	});

	const seeds = new Map<number, number>();
	const teamBySeed = new Map<number, number>();
	ranked.forEach((id, i) => { seeds.set(id, i + 1); teamBySeed.set(i + 1, id); });
	return { seeds, teamBySeed };
}

// ─── Bracket computation ──────────────────────────────────────────────────────

/**
 * Compute the full playoff bracket for a 12-team league with the custom
 * Chumpionship losers bracket.
 *
 * Bracket structure (3 playoff weeks):
 *
 * Week 1 (R1):  Byes: 1,2,7,8
 *   Winners: #3 vs #6 · #4 vs #5
 *   Losers:  #9 vs #12 · #10 vs #11
 *
 * Week 2 (R2):  No byes
 *   W-Semis:  #1 vs W(4v5) · #2 vs W(3v6)  → advance to Championship
 *   5/6 Game: L(3v6) vs L(4v5)             → clinch 5th/6th (vacation R3)
 *   L-Semis:  #7 vs W(10v11) · #8 vs W(9v12) → advance to Chumpionship
 *   11/12 Game: L(9v12) vs L(10v11)         → clinch 11th/12th (vacation R3)
 *
 * Week 3 (R3):  Vacation: 5th, 6th, 11th, 12th
 *   Championship: W(S1) vs W(S2)   → 1st / 2nd
 *   3rd Place:    L(S1) vs L(S2)   → 3rd / 4th
 *   Chumpionship: W(CS1) vs W(CS2) → 7th / 8th
 *   9/10 Place:   L(CS1) vs L(CS2) → 9th / 10th
 */
export function computePlayoffBracket(
	allDocs: WeeklyMatchupDoc[],
	seasonDoc: SeasonDoc
): PlayoffBracketState {
	const regularSeasonWeeks = seasonDoc.settings.regularSeasonWeeks;
	const regularDocs = allDocs.filter((d) => !d.isPlayoff);
	const playoffDocs = allDocs
		.filter((d) => d.isPlayoff)
		.sort((a, b) => a.scoringPeriodId - b.scoringPeriodId);

	const { seeds, teamBySeed } = computePlayoffSeeds(regularDocs, seasonDoc);
	const s = (seed: number) => teamBySeed.get(seed) ?? 0;

	const rounds: PlayoffRound[] = [];

	// ── Round 1 ───────────────────────────────────────────────────────────────
	const r1 = playoffDocs[0];
	if (r1) {
		rounds.push({
			week: r1.scoringPeriodId,
			onVacation: [s(1), s(2), s(7), s(8)],
			matchups: [
				bm(s(3), s(6), r1, [3, 6], '#3 vs #6'),
				bm(s(4), s(5), r1, [4, 5], '#4 vs #5'),
				bm(s(9), s(12), r1, [9, 12], '#9 vs #12'),
				bm(s(10), s(11), r1, [10, 11], '#10 vs #11'),
			]
		});
	}

	// ── Round 2 ───────────────────────────────────────────────────────────────
	const r2 = playoffDocs[1];
	if (r2 && rounds[0]) {
		const [m3v6, m4v5, m9v12, m10v11] = rounds[0].matchups;
		rounds.push({
			week: r2.scoringPeriodId,
			onVacation: [],
			matchups: [
				bm(s(1),          m4v5.winner,  r2, [1, 4],  'Semi: #1 vs W(#4/#5)'),
				bm(s(2),          m3v6.winner,  r2, [1, 4],  'Semi: #2 vs W(#3/#6)'),
				bm(loser(m4v5),   loser(m3v6),  r2, [5, 6],  '5th/6th Place'),
				bm(s(7),          m10v11.winner, r2, [7, 10], 'Chump Semi: #7 vs W(#10/#11)'),
				bm(s(8),          m9v12.winner,  r2, [7, 10], 'Chump Semi: #8 vs W(#9/#12)'),
				bm(loser(m9v12),  loser(m10v11), r2, [11, 12], '11th/12th Place'),
			]
		});
	}

	// ── Round 3 ───────────────────────────────────────────────────────────────
	const r3 = playoffDocs[2];
	if (r3 && rounds[1]) {
		const [mS1, mS2, m5v6, mCS1, mCS2, m11v12] = rounds[1].matchups;
		const onVac = [mS1, mS2, m5v6, mCS1, mCS2, m11v12]; // collect 5th, 6th, 11th, 12th
		const vacation: number[] = [];
		const w5 = m5v6.winner; const l6 = loser(m5v6);
		const w11 = m11v12.winner; const l12 = loser(m11v12);
		if (w5) vacation.push(w5);
		if (l6) vacation.push(l6);
		if (w11) vacation.push(w11);
		if (l12) vacation.push(l12);

		rounds.push({
			week: r3.scoringPeriodId,
			onVacation: vacation,
			matchups: [
				bm(mS1.winner,  mS2.winner,  r3, [1, 2], 'Championship 🏆'),
				bm(loser(mS1),  loser(mS2),  r3, [3, 4], '3rd Place'),
				bm(mCS1.winner, mCS2.winner, r3, [7, 8], 'Chumpionship 🚽'),
				bm(loser(mCS1), loser(mCS2), r3, [9, 10], '9th/10th Place'),
			]
		});
	}

	return { seeds, teamBySeed, rounds, regularSeasonWeeks };
}

/** Get the bracket round for a specific week, or null if not a playoff week. */
export function getPlayoffRoundForWeek(
	bracket: PlayoffBracketState,
	week: number
): PlayoffRound | null {
	return bracket.rounds.find((r) => r.week === week) ?? null;
}
