import type { WeeklyMatchupDoc, SeasonDoc, PlayerEntry } from './schema';

// ─── Constants ────────────────────────────────────────────────────────────────

const STARTER_SLOT_IDS = new Set([0, 2, 4, 6, 16, 17, 23]);

const POSITION_NAMES: Record<number, string> = {
	1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST'
};

const SLOT_NAMES: Record<number, string> = {
	0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 16: 'D/ST', 17: 'K', 23: 'FLEX', 20: 'Bench', 21: 'IR'
};

// ESPN proTeamId → NFL abbreviation
const PRO_TEAM_ABBR: Record<number, string> = {
	0: '',    // free agent
	1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE',
	6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB',  10: 'TEN',
	11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
	16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ',
	21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF',
	26: 'SEA', 27: 'TB',  28: 'WAS', 29: 'CAR', 30: 'JAX',
	33: 'BAL', 34: 'HOU'
};

// Injury statuses that mean a player was genuinely unavailable
const INJURED_OUT = new Set(['OUT', 'DOUBTFUL', 'IR', 'SUSPENSION']);

// ─── Output types ─────────────────────────────────────────────────────────────

export interface ProcessedPlayer {
	playerId: number;
	fullName: string;
	position: string;
	slotName: string;
	nflTeam: string;   // e.g. "KC", "LAR" — empty string for D/ST
	actualScore: number;
	projectedScore: number;
	projectedCeiling: number;
	scoreDelta: number;
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
	pointsLeftOnBench: number;
	wouldHaveBeaten: number;
	totalTeams: number;
	isLuckiest: boolean;
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
	nflTeam: string;
	actualScore: number;
	projectedScore: number;
	delta: number;
	position: string;
}

export interface LamestStud {
	playerName: string;
	teamName: string;
	nflTeam: string;
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

interface SlottedPlayer { player: PlayerEntry; slot: string; }

function computeOptimalLineup(
	roster: PlayerEntry[],
	slotCounts: Record<string, number>
): SlottedPlayer[] {
	const available = roster.filter((p) => p.lineupSlotId !== 21);

	const byPos: Record<number, PlayerEntry[]> = {};
	for (const p of available) {
		if (!byPos[p.defaultPositionId]) byPos[p.defaultPositionId] = [];
		byPos[p.defaultPositionId].push(p);
	}
	for (const pos in byPos) byPos[pos].sort((a, b) => b.actualScore - a.actualScore);

	const qbCount  = slotCounts['0']  ?? 1;
	const rbCount  = slotCounts['2']  ?? 2;
	const wrCount  = slotCounts['4']  ?? 3;
	const teCount  = slotCounts['6']  ?? 1;
	const kCount   = slotCounts['17'] ?? 1;
	const dstCount = slotCounts['16'] ?? 1;
	const flexCount = slotCounts['23'] ?? 1;

	const slotted: SlottedPlayer[] = [
		...(byPos[1]  ?? []).slice(0, qbCount).map(p  => ({ player: p, slot: 'QB' })),
		...(byPos[2]  ?? []).slice(0, rbCount).map(p  => ({ player: p, slot: 'RB' })),
		...(byPos[3]  ?? []).slice(0, wrCount).map(p  => ({ player: p, slot: 'WR' })),
		...(byPos[4]  ?? []).slice(0, teCount).map(p  => ({ player: p, slot: 'TE' })),
		...(byPos[5]  ?? []).slice(0, kCount).map(p   => ({ player: p, slot: 'K' })),
		...(byPos[16] ?? []).slice(0, dstCount).map(p => ({ player: p, slot: 'D/ST' })),
	];

	const usedIds = new Set(slotted.map((s) => s.player.playerId));
	const flexCandidates = [
		...(byPos[2] ?? []).filter((p) => !usedIds.has(p.playerId)),
		...(byPos[3] ?? []).filter((p) => !usedIds.has(p.playerId)),
		...(byPos[4] ?? []).filter((p) => !usedIds.has(p.playerId))
	].sort((a, b) => b.actualScore - a.actualScore);

	slotted.push(...flexCandidates.slice(0, flexCount).map(p => ({ player: p, slot: 'FLEX' })));
	return slotted;
}

// ─── Main processor ───────────────────────────────────────────────────────────

export function processWeek(
	weekDoc: WeeklyMatchupDoc,
	seasonDoc: SeasonDoc,
	ownerDict: Record<string, string> = {}
): ProcessedWeek {
	const teamMap = new Map(seasonDoc.teams.map((t) => [t.teamId, t]));
	const draftMap = new Map(seasonDoc.draft.picks.map((p) => [p.playerId, p]));
	const slotCounts = seasonDoc.settings.lineupSlotCounts;
	const earlyPickIds = new Set(
		seasonDoc.draft.picks.filter((p) => p.round <= 3).map((p) => p.playerId)
	);

	// Resolve team display name: ESPN name → OWNER_DICT fallback → "Team N"
	function resolveTeamName(teamId: number): { teamName: string; ownerName: string } {
		const info = teamMap.get(teamId);
		const espnName = info?.name?.trim();
		const ownerNames = info?.owners ?? [];
		const teamName = espnName || ownerDict[String(teamId)] || `Team ${teamId}`;
		const ownerName = ownerNames[0] || ownerDict[String(teamId)] || teamName;
		return { teamName, ownerName };
	}

	// Collect all team scores for cross-matchup comparisons
	const allTeamScores: Array<{ teamId: number; score: number; didWin: boolean }> = [];
	for (const m of weekDoc.matchups) {
		allTeamScores.push({ teamId: m.home.teamId, score: m.home.totalPoints, didWin: m.winner === 'HOME' });
		if (m.away) allTeamScores.push({ teamId: m.away.teamId, score: m.away.totalPoints, didWin: m.winner === 'AWAY' });
	}
	const totalTeams = allTeamScores.length;

	const wouldHaveBeatenMap = new Map<number, number>();
	for (const team of allTeamScores) {
		const count = allTeamScores.filter((o) => o.teamId !== team.teamId && team.score > o.score).length;
		wouldHaveBeatenMap.set(team.teamId, count);
	}

	const winners = allTeamScores.filter((t) => t.didWin);
	let luckiestTeamId: number | null = null;
	if (winners.length > 0) {
		const luckiest = winners.reduce((min, t) =>
			(wouldHaveBeatenMap.get(t.teamId) ?? 0) < (wouldHaveBeatenMap.get(min.teamId) ?? 0) ? t : min
		);
		luckiestTeamId = luckiest.teamId;
	}

	const allStartersByTeam: Array<{ player: ProcessedPlayer; teamId: number }> = [];

	function toProcessed(p: PlayerEntry): ProcessedPlayer {
		return {
			playerId: p.playerId,
			fullName: p.fullName,
			position: POSITION_NAMES[p.defaultPositionId] ?? '?',
			slotName: SLOT_NAMES[p.lineupSlotId] ?? '?',
			nflTeam: PRO_TEAM_ABBR[p.proTeamId] ?? '',
			actualScore: p.actualScore,
			projectedScore: p.projectedScore,
			projectedCeiling: p.projectedCeiling,
			scoreDelta: Math.round((p.actualScore - p.projectedScore) * 100) / 100,
			injuryStatus: p.injuryStatus
		};
	}

	function processTeamSide(side: (typeof weekDoc.matchups)[0]['home']): ProcessedTeam {
		const { teamName, ownerName } = resolveTeamName(side.teamId);

		const starters = side.roster
			.filter((p) => STARTER_SLOT_IDS.has(p.lineupSlotId) && p.lineupSlotId !== 21)
			.map(toProcessed);

		const bench = side.roster
			.filter((p) => !STARTER_SLOT_IDS.has(p.lineupSlotId) || p.lineupSlotId === 21)
			.map(toProcessed);

		const optimalSlotted = computeOptimalLineup(side.roster, slotCounts);
		const optimalStarters = optimalSlotted.map(({ player, slot }) => ({
			...toProcessed(player),
			slotName: slot   // correct slot (QB/RB/WR/TE/FLEX/D/ST/K)
		}));
		const optimalPoints = Math.round(optimalSlotted.reduce((s, { player }) => s + player.actualScore, 0) * 100) / 100;
		const pointsLeftOnBench = Math.max(0, Math.round((optimalPoints - side.totalPoints) * 100) / 100);

		for (const p of starters) allStartersByTeam.push({ player: p, teamId: side.teamId });

		return {
			teamId: side.teamId,
			teamName,
			ownerName,
			totalPoints: side.totalPoints,
			optimalPoints,
			pointsLeftOnBench,
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
		winner: m.winner === 'HOME' ? 'home' : m.winner === 'AWAY' ? 'away' : m.winner === 'TIE' ? 'tie' : 'undecided',
		home: processTeamSide(m.home),
		away: m.away ? processTeamSide(m.away) : undefined
	}));

	// ── Golden Apple / Brown Banana ───────────────────────────────────────────
	const qualifiedStarters = allStartersByTeam.filter((s) => s.player.projectedScore > 1);
	let goldenApple: LeagueAward | null = null;
	let brownBanana: LeagueAward | null = null;

	if (qualifiedStarters.length > 0) {
		const sorted = [...qualifiedStarters].sort((a, b) => b.player.scoreDelta - a.player.scoreDelta);
		const best = sorted[0];
		const worst = sorted[sorted.length - 1];

		const toAward = (s: typeof sorted[0]): LeagueAward => ({
			playerName: s.player.fullName,
			teamName: resolveTeamName(s.teamId).teamName,
			nflTeam: s.player.nflTeam,
			actualScore: s.player.actualScore,
			projectedScore: s.player.projectedScore,
			delta: s.player.scoreDelta,
			position: s.player.position
		});

		goldenApple = toAward(best);
		brownBanana = toAward(worst);
	}

	// ── Lamest Stud ───────────────────────────────────────────────────────────
	// Worst-scoring starter drafted in rounds 1–3, excluding players who were
	// injured/out (not their fault)
	let lamentStud: LamestStud | null = null;
	const studs = allStartersByTeam.filter(
		(s) => earlyPickIds.has(s.player.playerId) && !INJURED_OUT.has(s.player.injuryStatus)
	);
	if (studs.length > 0) {
		const lament = studs.reduce((min, s) => s.player.actualScore < min.player.actualScore ? s : min);
		const pick = draftMap.get(lament.player.playerId);
		lamentStud = {
			playerName: lament.player.fullName,
			teamName: resolveTeamName(lament.teamId).teamName,
			nflTeam: lament.player.nflTeam,
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
