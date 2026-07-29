import type { WeeklyMatchupDoc, SeasonDoc, PlayerEntry } from './schema';

// ─── Constants ────────────────────────────────────────────────────────────────

const STARTER_SLOT_IDS = new Set([0, 2, 4, 6, 16, 17, 23]);

const POSITION_NAMES: Record<number, string> = {
	1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST'
};

const SLOT_NAMES: Record<number, string> = {
	0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 16: 'D/ST', 17: 'K', 23: 'FLEX', 20: 'Bench', 21: 'IR'
};

// ─── Output types ─────────────────────────────────────────────────────────────

export interface ProcessedPlayer {
	playerId: number;
	fullName: string;
	position: string;
	slotName: string;
	actualScore: number;
	projectedScore: number;
	projectedCeiling: number;
	scoreDelta: number; // actual - projected
	injuryStatus: string;
}

export interface ProcessedTeam {
	teamId: number;
	teamName: string;
	ownerName: string;
	totalPoints: number;
	optimalPoints: number;
	starters: ProcessedPlayer[];
	bench: ProcessedPlayer[];
	optimalStarters: ProcessedPlayer[];
	pointsLeftOnBench: number; // optimalPoints - totalPoints
	wouldHaveBeaten: number; // out of all N teams this week
	totalTeams: number;
	isLuckiest: boolean; // 🍀 won despite lowest wouldHaveBeaten among winners
}

export interface ProcessedMatchup {
	matchupId: number;
	isPlayoff: boolean;
	playoffTierType: string;
	winner: 'home' | 'away' | 'tie' | 'undecided';
	home: ProcessedTeam;
	away?: ProcessedTeam;
}

export interface LeagueAward {
	playerName: string;
	teamName: string;
	actualScore: number;
	projectedScore: number;
	delta: number;
	position: string;
}

export interface LamestStud {
	playerName: string;
	teamName: string;
	actualScore: number;
	draftRound: number;
	overallPick: number;
	position: string;
}

export interface ProcessedWeek {
	leagueId: string;
	seasonId: number;
	scoringPeriodId: number;
	isPlayoffWeek: boolean;
	matchups: ProcessedMatchup[];
	goldenApple: LeagueAward | null;
	brownBanana: LeagueAward | null;
	lamentStud: LamestStud | null;
}

// ─── Optimal lineup ───────────────────────────────────────────────────────────

function computeOptimalLineup(
	roster: PlayerEntry[],
	slotCounts: Record<string, number>
): PlayerEntry[] {
	// Exclude IR — they can't be moved into the lineup
	const available = roster.filter((p) => p.lineupSlotId !== 21);

	// Group by defaultPositionId, sorted by actual score desc
	const byPos: Record<number, PlayerEntry[]> = {};
	for (const p of available) {
		const pos = p.defaultPositionId;
		if (!byPos[pos]) byPos[pos] = [];
		byPos[pos].push(p);
	}
	for (const pos in byPos) {
		byPos[pos].sort((a, b) => b.actualScore - a.actualScore);
	}

	const qbCount = slotCounts['0'] ?? 1;
	const rbCount = slotCounts['2'] ?? 2;
	const wrCount = slotCounts['4'] ?? 3;
	const teCount = slotCounts['6'] ?? 1;
	const kCount = slotCounts['17'] ?? 1;
	const dstCount = slotCounts['16'] ?? 1;
	const flexCount = slotCounts['23'] ?? 1;

	const starters: PlayerEntry[] = [
		...(byPos[1] ?? []).slice(0, qbCount), // QB
		...(byPos[2] ?? []).slice(0, rbCount), // RB
		...(byPos[3] ?? []).slice(0, wrCount), // WR
		...(byPos[4] ?? []).slice(0, teCount), // TE
		...(byPos[5] ?? []).slice(0, kCount), // K
		...(byPos[16] ?? []).slice(0, dstCount) // D/ST
	];

	// FLEX: best remaining RB/WR/TE
	const usedIds = new Set(starters.map((p) => p.playerId));
	const flexCandidates = [
		...(byPos[2] ?? []).filter((p) => !usedIds.has(p.playerId)),
		...(byPos[3] ?? []).filter((p) => !usedIds.has(p.playerId)),
		...(byPos[4] ?? []).filter((p) => !usedIds.has(p.playerId))
	].sort((a, b) => b.actualScore - a.actualScore);

	starters.push(...flexCandidates.slice(0, flexCount));
	return starters;
}

// ─── Main processor ───────────────────────────────────────────────────────────

export function processWeek(weekDoc: WeeklyMatchupDoc, seasonDoc: SeasonDoc): ProcessedWeek {
	const teamMap = new Map(seasonDoc.teams.map((t) => [t.teamId, t]));
	const draftMap = new Map(seasonDoc.draft.picks.map((p) => [p.playerId, p]));
	const slotCounts = seasonDoc.settings.lineupSlotCounts;
	const earlyPickIds = new Set(
		seasonDoc.draft.picks.filter((p) => p.round <= 3).map((p) => p.playerId)
	);

	// Collect all team scores for cross-matchup comparisons
	const allTeamScores: Array<{ teamId: number; score: number; didWin: boolean }> = [];
	for (const m of weekDoc.matchups) {
		const homeWon = m.winner === 'HOME';
		const awayWon = m.winner === 'AWAY';
		allTeamScores.push({ teamId: m.home.teamId, score: m.home.totalPoints, didWin: homeWon });
		if (m.away) {
			allTeamScores.push({ teamId: m.away.teamId, score: m.away.totalPoints, didWin: awayWon });
		}
	}
	const totalTeams = allTeamScores.length;

	// wouldHaveBeaten: how many other teams' scores this team beats
	const wouldHaveBeatenMap = new Map<number, number>();
	for (const team of allTeamScores) {
		const count = allTeamScores.filter(
			(other) => other.teamId !== team.teamId && team.score > other.score
		).length;
		wouldHaveBeatenMap.set(team.teamId, count);
	}

	// Luckiest: winning team with the lowest wouldHaveBeaten count
	const winners = allTeamScores.filter((t) => t.didWin);
	let luckiestTeamId: number | null = null;
	if (winners.length > 0) {
		const luckiest = winners.reduce((min, t) =>
			(wouldHaveBeatenMap.get(t.teamId) ?? 0) < (wouldHaveBeatenMap.get(min.teamId) ?? 0)
				? t
				: min
		);
		luckiestTeamId = luckiest.teamId;
	}

	// Collect all starters for league awards
	const allStartersByTeam: Array<{ player: ProcessedPlayer; teamId: number }> = [];

	function processTeamSide(side: (typeof weekDoc.matchups)[0]['home']): ProcessedTeam {
		const info = teamMap.get(side.teamId);
		const teamName = info?.name || `Team ${side.teamId}`;
		const ownerName = info?.owners[0] ?? teamName;

		const toProcessed = (p: PlayerEntry): ProcessedPlayer => ({
			playerId: p.playerId,
			fullName: p.fullName,
			position: POSITION_NAMES[p.defaultPositionId] ?? '?',
			slotName: SLOT_NAMES[p.lineupSlotId] ?? '?',
			actualScore: p.actualScore,
			projectedScore: p.projectedScore,
			projectedCeiling: p.projectedCeiling,
			scoreDelta: Math.round((p.actualScore - p.projectedScore) * 100) / 100,
			injuryStatus: p.injuryStatus
		});

		const starters = side.roster
			.filter((p) => STARTER_SLOT_IDS.has(p.lineupSlotId) && p.lineupSlotId !== 21)
			.map(toProcessed);

		const bench = side.roster
			.filter((p) => !STARTER_SLOT_IDS.has(p.lineupSlotId) || p.lineupSlotId === 21)
			.map(toProcessed);

		const optimalRaw = computeOptimalLineup(side.roster, slotCounts);
		const optimalStarters = optimalRaw.map(toProcessed);
		const optimalPoints =
			Math.round(optimalRaw.reduce((s, p) => s + p.actualScore, 0) * 100) / 100;
		const pointsLeftOnBench =
			Math.round((optimalPoints - side.totalPoints) * 100) / 100;

		for (const p of starters) {
			allStartersByTeam.push({ player: p, teamId: side.teamId });
		}

		return {
			teamId: side.teamId,
			teamName,
			ownerName,
			totalPoints: side.totalPoints,
			optimalPoints,
			pointsLeftOnBench: Math.max(0, pointsLeftOnBench),
			starters,
			bench,
			optimalStarters,
			wouldHaveBeaten: wouldHaveBeatenMap.get(side.teamId) ?? 0,
			totalTeams,
			isLuckiest: side.teamId === luckiestTeamId
		};
	}

	const matchups: ProcessedMatchup[] = weekDoc.matchups.map((m) => ({
		matchupId: m.matchupId,
		isPlayoff: weekDoc.isPlayoff,
		playoffTierType: m.playoffTierType,
		winner:
			m.winner === 'HOME'
				? 'home'
				: m.winner === 'AWAY'
					? 'away'
					: m.winner === 'TIE'
						? 'tie'
						: 'undecided',
		home: processTeamSide(m.home),
		away: m.away ? processTeamSide(m.away) : undefined
	}));

	// ── Golden Apple / Brown Banana ───────────────────────────────────────────
	// Only starters with a meaningful projection (avoids 0-projection skew)
	const qualifiedStarters = allStartersByTeam.filter((s) => s.player.projectedScore > 1);
	let goldenApple: LeagueAward | null = null;
	let brownBanana: LeagueAward | null = null;

	if (qualifiedStarters.length > 0) {
		const sorted = [...qualifiedStarters].sort((a, b) => b.player.scoreDelta - a.player.scoreDelta);
		const best = sorted[0];
		const worst = sorted[sorted.length - 1];

		goldenApple = {
			playerName: best.player.fullName,
			teamName: teamMap.get(best.teamId)?.name ?? `Team ${best.teamId}`,
			actualScore: best.player.actualScore,
			projectedScore: best.player.projectedScore,
			delta: best.player.scoreDelta,
			position: best.player.position
		};
		brownBanana = {
			playerName: worst.player.fullName,
			teamName: teamMap.get(worst.teamId)?.name ?? `Team ${worst.teamId}`,
			actualScore: worst.player.actualScore,
			projectedScore: worst.player.projectedScore,
			delta: worst.player.scoreDelta,
			position: worst.player.position
		};
	}

	// ── Lamest Stud ───────────────────────────────────────────────────────────
	let lamentStud: LamestStud | null = null;
	const studs = allStartersByTeam.filter((s) => earlyPickIds.has(s.player.playerId));
	if (studs.length > 0) {
		const lament = studs.reduce((min, s) =>
			s.player.actualScore < min.player.actualScore ? s : min
		);
		const pick = draftMap.get(lament.player.playerId);
		lamentStud = {
			playerName: lament.player.fullName,
			teamName: teamMap.get(lament.teamId)?.name ?? `Team ${lament.teamId}`,
			actualScore: lament.player.actualScore,
			draftRound: pick?.round ?? 1,
			overallPick: pick?.overallPick ?? 0,
			position: lament.player.position
		};
	}

	return {
		leagueId: weekDoc.leagueId,
		seasonId: weekDoc.seasonId,
		scoringPeriodId: weekDoc.scoringPeriodId,
		isPlayoffWeek: weekDoc.isPlayoff,
		matchups,
		goldenApple,
		brownBanana,
		lamentStud
	};
}
