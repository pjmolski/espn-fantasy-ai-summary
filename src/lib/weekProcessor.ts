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
	nflTeam: string;
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
	playerId: number;
	playerName: string;
	teamName: string;
	nflTeam: string;
	actualScore: number;
	projectedScore: number;
	delta: number;
	position: string;
}

export interface LamestStud {
	playerId: number;
	playerName: string;
	teamName: string;
	nflTeam: string;
	actualScore: number;
	draftRound: number;
	overallPick: number;
	position: string;
}

// ─── New award types ──────────────────────────────────────────────────────────

export interface SuperMushroomAward {
	teamId: number;
	teamName: string;
	actualScore: number;
	projectedScore: number;
	opponentName: string;
	opponentProjected: number;
}

export interface CloseShaveAward {
	teamId: number;
	teamName: string;
	margin: number;
	loserName: string;
	loserScore: number;
}

export interface AssassinAward {
	teamId: number;
	teamName: string;
	actualScore: number;
	victimName: string;
	victimScore: number;
}

export interface GamblerAward {
	teamId: number;
	teamName: string;
	successfulGambles: number;
}

export interface WrongManAward {
	teamId: number;
	teamName: string;
	startedName: string;
	benchedName: string;
	startedScore: number;
	benchedScore: number;
	pointsLeft: number;
}

export interface LuckyDevilAward {
	teamId: number;
	teamName: string;
	actualScore: number;
	wouldHaveBeaten: number;
	totalTeams: number;
}

export interface MrMonopolyAward {
	teamId: number;
	teamName: string;
	currentTotal: number;
	prevLeaderName: string;
	prevLeaderTotal: number;
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
	// New awards
	muscleMan: LeagueAward | null;
	poopMan: LeagueAward | null;
	superMushroom: SuperMushroomAward | null;
	closeShave: CloseShaveAward | null;
	assassins: AssassinAward[];
	gambler: GamblerAward | null;
	wrongMan: WrongManAward | null;
	luckyDevil: LuckyDevilAward | null;
	mrMonopoly: MrMonopolyAward | null;
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
	ownerDict: Record<string, string> = {},
	prevCumulativeScores: Map<number, number> = new Map()
): ProcessedWeek {
	const teamMap = new Map(seasonDoc.teams.map((t) => [t.teamId, t]));
	const draftMap = new Map(seasonDoc.draft.picks.map((p) => [p.playerId, p]));
	const slotCounts = seasonDoc.settings.lineupSlotCounts;
	const earlyPickIds = new Set(
		seasonDoc.draft.picks.filter((p) => p.round <= 3).map((p) => p.playerId)
	);

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
			slotName: slot
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
			playerId: s.player.playerId,
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
	let lamentStud: LamestStud | null = null;
	const studs = allStartersByTeam.filter(
		(s) => earlyPickIds.has(s.player.playerId) && !INJURED_OUT.has(s.player.injuryStatus)
	);
	if (studs.length > 0) {
		const lament = studs.reduce((min, s) => s.player.actualScore < min.player.actualScore ? s : min);
		const pick = draftMap.get(lament.player.playerId);
		lamentStud = {
			playerId: lament.player.playerId,
			playerName: lament.player.fullName,
			teamName: resolveTeamName(lament.teamId).teamName,
			nflTeam: lament.player.nflTeam,
			actualScore: lament.player.actualScore,
			draftRound: pick?.round ?? 1,
			overallPick: pick?.overallPick ?? 0,
			position: lament.player.position
		};
	}

	// ── Muscle Man 💪: highest scorer in starting lineups ───────────────────────
	let muscleMan: LeagueAward | null = null;
	{
		const eligible = allStartersByTeam.filter(s => s.player.actualScore > 0);
		if (eligible.length > 0) {
			const best = eligible.reduce((max, s) => s.player.actualScore > max.player.actualScore ? s : max);
			muscleMan = {
				playerId: best.player.playerId,
				playerName: best.player.fullName,
				teamName: resolveTeamName(best.teamId).teamName,
				nflTeam: best.player.nflTeam,
				actualScore: best.player.actualScore,
				projectedScore: best.player.projectedScore,
				delta: best.player.scoreDelta,
				position: best.player.position
			};
		}
	}

	// ── Poop Man 💩: lowest scorer (non-DST, non-K) in starting lineups ─────────
	let poopMan: LeagueAward | null = null;
	{
		const eligible = allStartersByTeam.filter(s =>
			s.player.position !== 'D/ST' && s.player.position !== 'K'
		);
		if (eligible.length > 0) {
			const worst = eligible.reduce((min, s) => s.player.actualScore < min.player.actualScore ? s : min);
			poopMan = {
				playerId: worst.player.playerId,
				playerName: worst.player.fullName,
				teamName: resolveTeamName(worst.teamId).teamName,
				nflTeam: worst.player.nflTeam,
				actualScore: worst.player.actualScore,
				projectedScore: worst.player.projectedScore,
				delta: worst.player.scoreDelta,
				position: worst.player.position
			};
		}
	}

	// ── Super Mushroom 🍄: projected to lose but won — single award, largest overperformance
	let superMushroom: SuperMushroomAward | null = null;
	{
		let maxDelta = -Infinity;
		for (const m of weekDoc.matchups) {
			if (!m.away || (m.winner !== 'HOME' && m.winner !== 'AWAY')) continue;
			const homeProj = m.home.roster
				.filter(p => STARTER_SLOT_IDS.has(p.lineupSlotId) && p.lineupSlotId !== 21)
				.reduce((s, p) => s + p.projectedScore, 0);
			const awayProj = m.away.roster
				.filter(p => STARTER_SLOT_IDS.has(p.lineupSlotId) && p.lineupSlotId !== 21)
				.reduce((s, p) => s + p.projectedScore, 0);
			if (homeProj < awayProj && m.winner === 'HOME') {
				const delta = m.home.totalPoints - homeProj;
				if (delta > maxDelta) {
					maxDelta = delta;
					superMushroom = {
						teamId: m.home.teamId,
						teamName: resolveTeamName(m.home.teamId).teamName,
						actualScore: m.home.totalPoints,
						projectedScore: Math.round(homeProj * 100) / 100,
						opponentName: resolveTeamName(m.away.teamId).teamName,
						opponentProjected: Math.round(awayProj * 100) / 100
					};
				}
			}
			if (awayProj < homeProj && m.winner === 'AWAY') {
				const delta = m.away.totalPoints - awayProj;
				if (delta > maxDelta) {
					maxDelta = delta;
					superMushroom = {
						teamId: m.away.teamId,
						teamName: resolveTeamName(m.away.teamId).teamName,
						actualScore: m.away.totalPoints,
						projectedScore: Math.round(awayProj * 100) / 100,
						opponentName: resolveTeamName(m.home.teamId).teamName,
						opponentProjected: Math.round(homeProj * 100) / 100
					};
				}
			}
		}
	}

	// ── Close Shave 💈: narrowest margin of victory (< 5 pts) ────────────────
	let closeShave: CloseShaveAward | null = null;
	{
		let minMargin = 5;
		for (const m of weekDoc.matchups) {
			if (!m.away || (m.winner !== 'HOME' && m.winner !== 'AWAY')) continue;
			const margin = Math.abs(m.home.totalPoints - m.away.totalPoints);
			if (margin < minMargin) {
				minMargin = margin;
				const winnerSide = m.winner === 'HOME' ? m.home : m.away;
				const loserSide  = m.winner === 'HOME' ? m.away : m.home;
				closeShave = {
					teamId:    winnerSide.teamId,
					teamName:  resolveTeamName(winnerSide.teamId).teamName,
					margin:    Math.round(margin * 100) / 100,
					loserName: resolveTeamName(loserSide.teamId).teamName,
					loserScore: loserSide.totalPoints
				};
			}
		}
	}

	// ── Assassin 🥷: beat a top-3 scoring team ────────────────────────────────
	const sortedByScore = [...allTeamScores].sort((a, b) => b.score - a.score);
	const top3Ids = new Set(sortedByScore.slice(0, 3).map(t => t.teamId));
	const assassins: AssassinAward[] = [];
	for (const m of weekDoc.matchups) {
		if (!m.away || (m.winner !== 'HOME' && m.winner !== 'AWAY')) continue;
		if (top3Ids.has(m.away.teamId) && m.winner === 'HOME') {
			assassins.push({
				teamId:    m.home.teamId,
				teamName:  resolveTeamName(m.home.teamId).teamName,
				actualScore: m.home.totalPoints,
				victimName:  resolveTeamName(m.away.teamId).teamName,
				victimScore: m.away.totalPoints
			});
		}
		if (top3Ids.has(m.home.teamId) && m.winner === 'AWAY') {
			assassins.push({
				teamId:    m.away.teamId,
				teamName:  resolveTeamName(m.away.teamId).teamName,
				actualScore: m.away.totalPoints,
				victimName:  resolveTeamName(m.home.teamId).teamName,
				victimScore: m.home.totalPoints
			});
		}
	}

	// ── Gambler 🎲: most position-specific successful gambles (unique bench pairing) ────
	// A gamble: starter outscores a higher-projected bench player in the same position group.
	// FLEX starters pair against RB/WR/TE bench. Each bench player counts at most once.
	let gambler: GamblerAward | null = null;
	{
		const gamblerSlotPos = (slotName: string): string[] => {
			if (slotName === 'FLEX') return ['RB', 'WR', 'TE'];
			return [slotName]; // QB→QB, RB→RB, WR→WR, TE→TE, K→K, D/ST→D/ST
		};

		let maxGambles = 0;
		for (const m of matchups) {
			for (const t of [m.home, m.away].filter(Boolean) as ProcessedTeam[]) {
				const usedBenchIds = new Set<number>();
				let count = 0;
				// Process starters highest-actual-score first (greedy: strongest wins get first pick)
				const sortedStarters = [...t.starters].sort((a, b) => b.actualScore - a.actualScore);
				for (const starter of sortedStarters) {
					const eligiblePos = gamblerSlotPos(starter.slotName);
					// Find best unused bench player: position match, higher proj, starter beat them
					let bestBench: ProcessedPlayer | null = null;
					for (const bench of t.bench) {
						if (usedBenchIds.has(bench.playerId)) continue;
						if (!eligiblePos.includes(bench.position)) continue;
						if (bench.projectedScore <= starter.projectedScore) continue;
						if (starter.actualScore <= bench.actualScore) continue;
						if (!bestBench || bench.projectedScore > bestBench.projectedScore) {
							bestBench = bench;
						}
					}
					if (bestBench) {
						usedBenchIds.add(bestBench.playerId);
						count++;
					}
				}
				if (count >= 2 && count > maxGambles) {
					maxGambles = count;
					gambler = { teamId: t.teamId, teamName: t.teamName, successfulGambles: count };
				}
			}
		}
	}

	// ── Wrong Man 👥: biggest missed pts from a single starter→bench swap ─────
	let wrongMan: WrongManAward | null = null;
	{
		let maxDelta = 0;
		const canFill = (benchPos: string, starterSlot: string) =>
			benchPos === starterSlot ||
			(['RB', 'WR', 'TE'].includes(benchPos) && starterSlot === 'FLEX');

		for (const m of matchups) {
			for (const t of [m.home, m.away].filter(Boolean) as ProcessedTeam[]) {
				for (const starter of t.starters) {
					for (const bench of t.bench) {
						if (!canFill(bench.position, starter.slotName)) continue;
						const delta = bench.actualScore - starter.actualScore;
						if (delta > maxDelta) {
							maxDelta = delta;
							wrongMan = {
								teamId:       t.teamId,
								teamName:     t.teamName,
								startedName:  starter.fullName,
								benchedName:  bench.fullName,
								startedScore: starter.actualScore,
								benchedScore: bench.actualScore,
								pointsLeft:   Math.round(delta * 100) / 100
							};
						}
					}
				}
			}
		}
	}

	// ── Lucky Devil 🍀: lowest-scoring winner, but only if they scored in bottom half (wouldHaveBeaten < 6)
	let luckyDevil: LuckyDevilAward | null = null;
	if (luckiestTeamId !== null && (wouldHaveBeatenMap.get(luckiestTeamId) ?? 0) < 6) {
		outer: for (const m of matchups) {
			for (const t of [m.home, m.away].filter(Boolean) as ProcessedTeam[]) {
				if (t.teamId === luckiestTeamId) {
					luckyDevil = {
						teamId: t.teamId,
						teamName: t.teamName,
						actualScore: t.totalPoints,
						wouldHaveBeaten: t.wouldHaveBeaten,
						totalTeams
					};
					break outer;
				}
			}
		}
	}

	// ── Mr. Monopoly 🎩: overtook the cumulative season points lead ───────────
	let mrMonopoly: MrMonopolyAward | null = null;
	if (prevCumulativeScores.size > 0) {
		// Find previous leader
		let prevLeaderId = -1;
		let prevLeaderScore = 0;
		for (const [tid, score] of prevCumulativeScores) {
			if (score > prevLeaderScore) { prevLeaderScore = score; prevLeaderId = tid; }
		}
		// Add this week's scores
		const currentTotals = new Map(prevCumulativeScores);
		for (const m of weekDoc.matchups) {
			currentTotals.set(m.home.teamId, (currentTotals.get(m.home.teamId) ?? 0) + m.home.totalPoints);
			if (m.away) currentTotals.set(m.away.teamId, (currentTotals.get(m.away.teamId) ?? 0) + m.away.totalPoints);
		}
		// Find current leader
		let currentLeaderId = -1;
		let currentLeaderScore = 0;
		for (const [tid, score] of currentTotals) {
			if (score > currentLeaderScore) { currentLeaderScore = score; currentLeaderId = tid; }
		}
		// Award only if a different team now leads
		if (currentLeaderId !== -1 && currentLeaderId !== prevLeaderId) {
			mrMonopoly = {
				teamId:          currentLeaderId,
				teamName:        resolveTeamName(currentLeaderId).teamName,
				currentTotal:    Math.round(currentLeaderScore * 100) / 100,
				prevLeaderName:  prevLeaderId !== -1 ? resolveTeamName(prevLeaderId).teamName : 'No prior leader',
				prevLeaderTotal: Math.round(prevLeaderScore * 100) / 100
			};
		}
	}

	return {
		leagueId: weekDoc.leagueId,
		seasonId: weekDoc.seasonId,
		scoringPeriodId: weekDoc.scoringPeriodId,
		isPlayoffWeek: weekDoc.isPlayoff,
		matchups,
		goldenApple,
		brownBanana,
		lamentStud,
		muscleMan,
		poopMan,
		superMushroom,
		closeShave,
		assassins,
		gambler,
		wrongMan,
		luckyDevil,
		mrMonopoly
	};
}
