import { getAvailableWeeks, getWeeklyMatchupDoc, getSeasonDoc, getCumulativeScoresByWeek, getAllWeeklyDocs, getAllSeasonDocs, computeAllTimeH2H, getH2H, detectPreviewWeek } from '$lib/fantasyDataService';
import { processWeek } from '$lib/weekProcessor';
import { computeStandingsHistory, computeStreaks } from '$lib/standingsHistory';
import { computePlayoffBracket, getPlayoffRoundForWeek } from '$lib/playoffBracket';
import { fetchWeeklyProjections, parsePreviewMatchups, type PreviewMatchupRaw } from '$lib/espnApi';
import { getEspnCookies } from '$lib/cookieStore';
import { LEAGUE_ID, OWNER_DICT } from '$env/static/private';

// ── Lookup tables (mirrors weekProcessor.ts — needed for preview processing) ──
const PREV_POS: Record<number, string> = { 1:'QB', 2:'RB', 3:'WR', 4:'TE', 5:'K', 16:'D/ST' };
const PREV_SLOT: Record<number, string> = { 0:'QB', 2:'RB', 4:'WR', 6:'TE', 16:'D/ST', 17:'K', 23:'FLEX', 20:'Bench', 21:'IR' };
const PREV_NFL: Record<number, string> = {
	0:'',    1:'ATL', 2:'BUF', 3:'CHI', 4:'CIN', 5:'CLE', 6:'DAL', 7:'DEN', 8:'DET', 9:'GB',  10:'TEN',
	11:'IND', 12:'KC', 13:'LV', 14:'LAR', 15:'MIA', 16:'MIN', 17:'NE', 18:'NO', 19:'NYG', 20:'NYJ',
	21:'PHI', 22:'ARI', 23:'PIT', 24:'LAC', 25:'SF', 26:'SEA', 27:'TB',  28:'WAS', 29:'CAR', 30:'JAX',
	33:'BAL', 34:'HOU'
};

/** Compute optimal lineup sorted by projected score (for preview/cake mode). */
function computeOptimalByProjection(
	roster: PreviewMatchupRaw['home']['roster'],
	slotCounts: Record<string, number>
) {
	const available = roster.filter((p) => p.lineupSlotId !== 21); // exclude IR
	const byPos: Record<number, typeof available> = {};
	for (const p of available) {
		if (!byPos[p.defaultPositionId]) byPos[p.defaultPositionId] = [];
		byPos[p.defaultPositionId].push(p);
	}
	for (const pos in byPos) byPos[pos].sort((a, b) => b.projectedScore - a.projectedScore);

	const qbC  = slotCounts['0']  ?? 1, rbC  = slotCounts['2']  ?? 2, wrC  = slotCounts['4']  ?? 3;
	const teC  = slotCounts['6']  ?? 1, kC   = slotCounts['17'] ?? 1, dstC = slotCounts['16'] ?? 1;
	const flexC = slotCounts['23'] ?? 1;

	const slotted: { player: typeof available[0]; slot: string }[] = [
		...(byPos[1]  ?? []).slice(0, qbC ).map((p) => ({ player: p, slot: 'QB'   })),
		...(byPos[2]  ?? []).slice(0, rbC ).map((p) => ({ player: p, slot: 'RB'   })),
		...(byPos[3]  ?? []).slice(0, wrC ).map((p) => ({ player: p, slot: 'WR'   })),
		...(byPos[4]  ?? []).slice(0, teC ).map((p) => ({ player: p, slot: 'TE'   })),
		...(byPos[5]  ?? []).slice(0, kC  ).map((p) => ({ player: p, slot: 'K'    })),
		...(byPos[16] ?? []).slice(0, dstC).map((p) => ({ player: p, slot: 'D/ST' })),
	];
	const usedIds = new Set(slotted.map((s) => s.player.playerId));
	const flexCands = [
		...(byPos[2] ?? []).filter((p) => !usedIds.has(p.playerId)),
		...(byPos[3] ?? []).filter((p) => !usedIds.has(p.playerId)),
		...(byPos[4] ?? []).filter((p) => !usedIds.has(p.playerId)),
	].sort((a, b) => b.projectedScore - a.projectedScore);
	slotted.push(...flexCands.slice(0, flexC).map((p) => ({ player: p, slot: 'FLEX' })));
	return slotted;
}

interface StandingsRow {
	teamId: number;
	teamName: string;
	logoUrl?: string;
	weekScore?: number;
	projectedScore?: number;
	pf: number;
	pa: number;
	apf: number;
	apa: number;
	w: number;
	l: number;
	pct: number;
	streak: string;
	lrW: number;
	lrL: number;
	lrT: number;
	hi: number;
	lo: number;
	weeksPlayed: number;
	seed: number;
}

function buildStandingsTable(opts: {
	weekDocs: import('$lib/schema').WeeklyMatchupDoc[];
	currentScoringPeriodId?: number;
	teamRecords: Record<number, { wins: number; losses: number }>;
	leagueRecord: Record<number, { wins: number; losses: number; ties: number }>;
	teamInfo: Array<{ teamId: number; teamName: string; logoUrl?: string }>;
	previewProjections?: Map<number, number>;
}): StandingsRow[] {
	const { weekDocs, currentScoringPeriodId, teamRecords, leagueRecord, teamInfo, previewProjections } = opts;

	const streaks = computeStreaks(weekDocs);

	const pfMap  = new Map<number, number>();
	const paMap  = new Map<number, number>();
	const hiMap  = new Map<number, number>();
	const loMap  = new Map<number, number>();
	const wkMap  = new Map<number, number>();
	const wkScoreMap = new Map<number, number>();

	for (const doc of weekDocs) {
		for (const m of doc.matchups) {
			const hScore = m.home.totalPoints;
			const aScore = m.away?.totalPoints ?? 0;

			pfMap.set(m.home.teamId, (pfMap.get(m.home.teamId) ?? 0) + hScore);
			paMap.set(m.home.teamId, (paMap.get(m.home.teamId) ?? 0) + aScore);
			hiMap.set(m.home.teamId, Math.max(hiMap.get(m.home.teamId) ?? 0, hScore));
			const prevLo = loMap.get(m.home.teamId);
			loMap.set(m.home.teamId, prevLo === undefined ? hScore : Math.min(prevLo, hScore));
			wkMap.set(m.home.teamId, (wkMap.get(m.home.teamId) ?? 0) + 1);

			if (m.away) {
				pfMap.set(m.away.teamId, (pfMap.get(m.away.teamId) ?? 0) + aScore);
				paMap.set(m.away.teamId, (paMap.get(m.away.teamId) ?? 0) + hScore);
				hiMap.set(m.away.teamId, Math.max(hiMap.get(m.away.teamId) ?? 0, aScore));
				const prevLoA = loMap.get(m.away.teamId);
				loMap.set(m.away.teamId, prevLoA === undefined ? aScore : Math.min(prevLoA, aScore));
				wkMap.set(m.away.teamId, (wkMap.get(m.away.teamId) ?? 0) + 1);
			}

			if (currentScoringPeriodId !== undefined && doc.scoringPeriodId === currentScoringPeriodId) {
				wkScoreMap.set(m.home.teamId, hScore);
				if (m.away) wkScoreMap.set(m.away.teamId, aScore);
			}
		}
	}

	const allIds = new Set<number>([
		...teamInfo.map(t => t.teamId),
		...Object.keys(teamRecords).map(Number),
		...Object.keys(leagueRecord).map(Number),
	]);

	const rows: StandingsRow[] = [];
	for (const teamId of allIds) {
		const info  = teamInfo.find(t => t.teamId === teamId);
		const rec   = teamRecords[teamId]  ?? { wins: 0, losses: 0 };
		const lr    = leagueRecord[teamId] ?? { wins: 0, losses: 0, ties: 0 };
		const strk  = streaks.get(teamId);
		const weeks = wkMap.get(teamId) ?? 0;
		const pf    = pfMap.get(teamId) ?? 0;
		const pa    = paMap.get(teamId) ?? 0;
		const hi    = hiMap.get(teamId) ?? 0;
		const lo    = loMap.get(teamId) ?? 0;
		const total = rec.wins + rec.losses;

		rows.push({
			teamId,
			teamName:       info?.teamName ?? `Team ${teamId}`,
			logoUrl:        info?.logoUrl,
			weekScore:      currentScoringPeriodId !== undefined ? (wkScoreMap.get(teamId) ?? 0) : undefined,
			projectedScore: previewProjections?.get(teamId),
			pf,
			pa,
			apf:    weeks > 0 ? Math.round((pf / weeks) * 100) / 100 : 0,
			apa:    weeks > 0 ? Math.round((pa / weeks) * 100) / 100 : 0,
			w:      rec.wins,
			l:      rec.losses,
			pct:    total > 0 ? rec.wins / total : 0,
			streak: strk ? `${strk.type}${strk.count}` : '\u2014',
			lrW:    lr.wins,
			lrL:    lr.losses,
			lrT:    lr.ties,
			hi,
			lo,
			weeksPlayed: weeks,
			seed: 0,
		});
	}

	rows.sort((a, b) => b.w !== a.w ? b.w - a.w : b.pf - a.pf);
	rows.forEach((r, i) => { r.seed = i + 1; });

	return rows;
}

export async function load({ url }) {
	try {
		const [availableWeeks, previewWeekInfo] = await Promise.all([
			getAvailableWeeks(LEAGUE_ID),
			detectPreviewWeek(LEAGUE_ID),
		]);

		if (availableWeeks.length === 0 && !previewWeekInfo) {
			return { availableWeeks: [], weekData: null, isPreviewWeek: false, previewWeekId: null, previewMatchups: [], standingsHistory: [], matchupH2H: {}, teamRecords: {} };
		}

		const allWeeks = [
			...(previewWeekInfo ? [{ ...previewWeekInfo, isPreview: true as const }] : []),
			...availableWeeks.map((w) => ({ ...w, isPreview: false as const })),
		];

		const seasonParam = url.searchParams.get('season');
		const weekParam   = url.searchParams.get('week');

		const target = seasonParam && weekParam
			? (allWeeks.find((w) => w.seasonId === parseInt(seasonParam) && w.scoringPeriodId === parseInt(weekParam)) ?? allWeeks[0])
			: allWeeks[0];

		let ownerDict: Record<string, string> = {};
		try { ownerDict = JSON.parse(OWNER_DICT || '{}'); } catch { ownerDict = {}; }

		// ── Preview week branch ───────────────────────────────────────────────────
		if (target.isPreview) {
			const [seasonDoc, espnCookies, weekDocs, allSeasonDocs, h2hRecords] = await Promise.all([
				getSeasonDoc(LEAGUE_ID, target.seasonId),
				getEspnCookies(),
				getAllWeeklyDocs(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
				getAllSeasonDocs(LEAGUE_ID, target.seasonId),
				computeAllTimeH2H(LEAGUE_ID),
			]);

			// Fetch ESPN projection data; try unauthenticated first, fall back to cookies
			let rawPreview: any;
			try {
				rawPreview = await fetchWeeklyProjections(LEAGUE_ID, target.seasonId, target.scoringPeriodId);
			} catch {
				if (espnCookies) {
					rawPreview = await fetchWeeklyProjections(
						LEAGUE_ID, target.seasonId, target.scoringPeriodId,
						{ swid: espnCookies.swid, espn_s2: espnCookies.espn_s2 }
					);
				} else {
					throw new Error('Cannot fetch preview data — ESPN API unavailable and no cookies stored');
				}
			}

			const rawMatchups = parsePreviewMatchups(rawPreview, target.scoringPeriodId);

			// Build team info map: prefer stored seasonDoc, fall back to data embedded in the ESPN response
			const espnMembers: any[] = rawPreview.members ?? [];
			const memberNameMap = new Map<string, string>(
				espnMembers.map((m: any) => [m.id, m.displayName ?? `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()])
			);
			const espnTeams: any[] = rawPreview.teams ?? [];
			const fallbackTeamMap = new Map<number, { name: string; owners: string[]; logoUrl?: string }>(
				espnTeams.map((t: any) => [t.id as number, {
					name: t.name?.trim() ?? `Team ${t.id}`,
					owners: (t.owners ?? []).map((id: string) => memberNameMap.get(id) ?? id),
					logoUrl: t.logo ?? undefined,
				}])
			);

			const teamInfoMap = new Map((seasonDoc?.teams ?? []).map((t) => [t.teamId, t]));
			const slotCounts  = (seasonDoc?.settings?.lineupSlotCounts ?? {}) as Record<string, number>;

			const mapPlayer = (p: PreviewMatchupRaw['home']['roster'][0], slot?: string) => ({
				playerId:        p.playerId,
				fullName:        p.fullName,
				position:        PREV_POS[p.defaultPositionId]  ?? '?',
				slotName:        slot ?? PREV_SLOT[p.lineupSlotId] ?? 'Bench',
				nflTeam:         PREV_NFL[p.proTeamId]           ?? '',
				lineupSlotId:    p.lineupSlotId,
				isStarter:       p.isStarter,
				projectedScore:  p.projectedScore,
				projectedCeiling: p.projectedCeiling,
				injuryStatus:    p.injuryStatus,
			});

			const processTeam = (side: PreviewMatchupRaw['home']) => {
				const info     = teamInfoMap.get(side.teamId);
				const fallback = fallbackTeamMap.get(side.teamId);
				const ownerRaw = info?.owners?.[0] ?? fallback?.owners?.[0] ?? '';
				const starters = side.roster.filter((p) => p.isStarter).map((p) => mapPlayer(p));
				const bench    = side.roster.filter((p) => !p.isStarter && p.lineupSlotId !== 21).map((p) => mapPlayer(p));
				const optSlotted    = computeOptimalByProjection(side.roster, slotCounts);
				const optimalStarters = optSlotted.map(({ player, slot }) => mapPlayer(player, slot));
				const projectedOptimalPoints = Math.round(
					optimalStarters.reduce((s, p) => s + p.projectedScore, 0) * 100
				) / 100;
				return {
					teamId:               side.teamId,
					teamName:             info?.name ?? fallback?.name ?? `Team ${side.teamId}`,
					ownerName:            ownerDict[ownerRaw] ?? ownerRaw,
					logoUrl:              info?.logoUrl ?? fallback?.logoUrl,
					projectedPoints:      Math.round(side.projectedPoints * 100) / 100,
					winProbability:       side.winProbability,
					starters,
					bench,
					optimalStarters,
					projectedOptimalPoints,
				};
			};

			const previewMatchups = rawMatchups.map((raw) => {
				const { aWins, bWins, ties } = raw.away
					? getH2H(h2hRecords, raw.home.teamId, raw.away.teamId)
					: { aWins: 0, bWins: 0, ties: 0 };
				return {
					matchupId:       raw.matchupId,
					playoffTierType: raw.playoffTierType,
					home:            processTeam(raw.home),
					away:            raw.away ? processTeam(raw.away) : undefined,
					h2h:             raw.away ? { homeWins: aWins, awayWins: bWins, ties } : undefined,
				};
			});

			// Standings through the last completed week
			const bracket     = seasonDoc ? computePlayoffBracket(allSeasonDocs, seasonDoc) : null;
			const rawHistory  = seasonDoc ? computeStandingsHistory(allSeasonDocs, seasonDoc, bracket ?? undefined) : [];
			const standingsHistory = rawHistory.map((entry) => ({
				...entry,
				weeklyRanks: entry.weeklyRanks.filter((r) => r.week < target.scoringPeriodId),
			}));

			// W-L records through last stored week
			const teamRecords: Record<number, { wins: number; losses: number }> = {};
			for (const doc of weekDocs) {
				for (const m of doc.matchups) {
					if (!m.away || m.winner === 'UNDECIDED') continue;
					const hId = m.home.teamId, aId = m.away.teamId;
					if (!teamRecords[hId]) teamRecords[hId] = { wins: 0, losses: 0 };
					if (!teamRecords[aId]) teamRecords[aId] = { wins: 0, losses: 0 };
					if (m.winner === 'HOME')      { teamRecords[hId].wins++;  teamRecords[aId].losses++; }
					else if (m.winner === 'AWAY') { teamRecords[aId].wins++;  teamRecords[hId].losses++; }
				}
			}

			// League record from all stored weeks (preview week hasn't been played)
			const leagueRecord: Record<number, { wins: number; losses: number; ties: number }> = {};
			for (const doc of weekDocs) {
				const weekScores: Array<{ teamId: number; score: number }> = [];
				for (const m of doc.matchups) {
					weekScores.push({ teamId: m.home.teamId, score: m.home.totalPoints });
					if (m.away) weekScores.push({ teamId: m.away.teamId, score: m.away.totalPoints });
				}
				for (const team of weekScores) {
					if (!leagueRecord[team.teamId]) leagueRecord[team.teamId] = { wins: 0, losses: 0, ties: 0 };
					for (const other of weekScores) {
						if (other.teamId === team.teamId) continue;
						if (team.score > other.score)      leagueRecord[team.teamId].wins++;
						else if (team.score < other.score) leagueRecord[team.teamId].losses++;
						else                               leagueRecord[team.teamId].ties++;
					}
				}
			}

			const previewProjections = new Map<number, number>(
				previewMatchups.flatMap(pm => {
					const arr: [number, number][] = [[pm.home.teamId, pm.home.projectedPoints]];
					if (pm.away) arr.push([pm.away.teamId, pm.away.projectedPoints]);
					return arr;
				})
			);

			const previewTeamInfo = (seasonDoc?.teams ?? []).map(t => ({
				teamId: t.teamId,
				teamName: t.name,
				logoUrl: t.logoUrl,
			}));

			const standingsTable = buildStandingsTable({
				weekDocs,
				teamRecords,
				leagueRecord,
				teamInfo: previewTeamInfo,
				previewProjections,
			});

			return {
				availableWeeks: allWeeks,
				weekData:       null,
				isPreviewWeek:  true,
				previewWeekId:  { seasonId: target.seasonId, scoringPeriodId: target.scoringPeriodId },
				previewMatchups,
				standingsHistory,
				matchupH2H: {},
				teamRecords,
				leagueRecord,
				standingsTable,
			};
		}

		// ── Stored week branch ────────────────────────────────────────────────────
		const [weekDoc, seasonDoc, prevScores, weekDocs, allSeasonDocs, h2hRecords] = await Promise.all([
			getWeeklyMatchupDoc(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
			getSeasonDoc(LEAGUE_ID, target.seasonId),
			getCumulativeScoresByWeek(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
			getAllWeeklyDocs(LEAGUE_ID, target.seasonId, target.scoringPeriodId),
			getAllSeasonDocs(LEAGUE_ID, target.seasonId),
			computeAllTimeH2H(LEAGUE_ID)
		]);

		const streaks     = computeStreaks(weekDocs);
		const bracket     = seasonDoc ? computePlayoffBracket(allSeasonDocs, seasonDoc) : null;
		const playoffRound = bracket && weekDoc ? getPlayoffRoundForWeek(bracket, weekDoc.scoringPeriodId) : null;

		const weekData = weekDoc && seasonDoc
			? processWeek(weekDoc, seasonDoc, ownerDict, prevScores, streaks, playoffRound, bracket?.seeds ?? null)
			: null;
		const rawHistory = seasonDoc ? computeStandingsHistory(allSeasonDocs, seasonDoc, bracket ?? undefined) : [];

		const standingsHistory = rawHistory.map((entry) => ({
			...entry,
			weeklyRanks: entry.weeklyRanks.filter((r) => r.week <= target.scoringPeriodId)
		}));

		// Only set brassNuts/toiletBowl on championship week (last playoff round = regularSeasonWeeks + 3)
		const isChampionshipWeek = seasonDoc && target.scoringPeriodId === seasonDoc.settings.regularSeasonWeeks + 3;
		if (weekData?.isPlayoffWeek && isChampionshipWeek) {
			for (const entry of standingsHistory) {
				const lastRank = entry.weeklyRanks[entry.weeklyRanks.length - 1]?.rank;
				if (lastRank === 1) weekData.brassNuts  = { teamId: entry.teamId, teamName: entry.teamName };
				if (lastRank === 7) weekData.toiletBowl = { teamId: entry.teamId, teamName: entry.teamName };
			}
		}

		const teamRecords: Record<number, { wins: number; losses: number }> = {};
		for (const doc of weekDocs) {
			for (const m of doc.matchups) {
				if (!m.away || m.winner === 'UNDECIDED') continue;
				const homeId = m.home.teamId, awayId = m.away.teamId;
				if (!teamRecords[homeId]) teamRecords[homeId] = { wins: 0, losses: 0 };
				if (!teamRecords[awayId]) teamRecords[awayId] = { wins: 0, losses: 0 };
				if (m.winner === 'HOME')      { teamRecords[homeId].wins++;  teamRecords[awayId].losses++; }
				else if (m.winner === 'AWAY') { teamRecords[awayId].wins++;  teamRecords[homeId].losses++; }
			}
		}

		// ── League-wide record (every team vs. every other team each week) ──────────
		// After N weeks each team has N*(teamCount-1) games in this record.
		const leagueRecord: Record<number, { wins: number; losses: number; ties: number }> = {};
		for (const doc of weekDocs) {
			const weekScores: Array<{ teamId: number; score: number }> = [];
			for (const m of doc.matchups) {
				weekScores.push({ teamId: m.home.teamId, score: m.home.totalPoints });
				if (m.away) weekScores.push({ teamId: m.away.teamId, score: m.away.totalPoints });
			}
			for (const team of weekScores) {
				if (!leagueRecord[team.teamId]) leagueRecord[team.teamId] = { wins: 0, losses: 0, ties: 0 };
				for (const other of weekScores) {
					if (other.teamId === team.teamId) continue;
					if (team.score > other.score)      leagueRecord[team.teamId].wins++;
					else if (team.score < other.score) leagueRecord[team.teamId].losses++;
					else                               leagueRecord[team.teamId].ties++;
				}
			}
		}

		const matchupH2H: Record<string, { homeWins: number; awayWins: number; ties: number }> = {};
		if (weekData) {
			for (const m of weekData.matchups) {
				if (!m.away) continue;
				const { aWins, bWins, ties } = getH2H(h2hRecords, m.home.teamId, m.away.teamId);
				matchupH2H[m.matchupId] = { homeWins: aWins, awayWins: bWins, ties };
			}
		}

		const recapTeamInfo = (seasonDoc?.teams ?? []).map(t => ({
			teamId: t.teamId,
			teamName: t.name,
			logoUrl: t.logoUrl,
		}));

		const standingsTable = buildStandingsTable({
			weekDocs,
			currentScoringPeriodId: target.scoringPeriodId,
			teamRecords,
			leagueRecord,
			teamInfo: recapTeamInfo,
		});

		return {
			availableWeeks: allWeeks,
			weekData,
			isPreviewWeek:  false,
			previewWeekId:  null,
			previewMatchups: [],
			standingsHistory,
			matchupH2H,
			teamRecords,
			leagueRecord,
			standingsTable,
		};
	} catch (error) {
		console.error('Page load error:', error);
		return {
			availableWeeks:  [],
			weekData:        null,
			isPreviewWeek:   false,
			previewWeekId:   null,
			previewMatchups: [],
			standingsHistory: [],
			matchupH2H:      {},
			teamRecords:     {},
			leagueRecord:    {},
			standingsTable:  [],
			error: error instanceof Error ? error.message : 'Failed to load data'
		};
	}
}
