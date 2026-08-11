import { getAvailableWeeks, getWeeklyMatchupDoc, getSeasonDoc, getCumulativeScoresByWeek, getAllWeeklyDocs, getAllSeasonDocs, computeAllTimeH2H, getH2H, detectPreviewWeek, getWeekPerformance } from '$lib/fantasyDataService';
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

export async function load({ url }) {
	try {
		const [availableWeeks, previewWeekInfo, weekPerformance] = await Promise.all([
			getAvailableWeeks(LEAGUE_ID),
			detectPreviewWeek(LEAGUE_ID),
			getWeekPerformance(LEAGUE_ID),
		]);

		if (availableWeeks.length === 0 && !previewWeekInfo) {
			return { availableWeeks: [], weekData: null, isPreviewWeek: false, previewWeekId: null, previewMatchups: [], standingsHistory: [], matchupH2H: {}, teamRecords: {}, weekPerformance: { perf: {}, currentTeams: [] } };
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

			return {
				availableWeeks: allWeeks,
				weekData:       null,
				isPreviewWeek:  true,
				previewWeekId:  { seasonId: target.seasonId, scoringPeriodId: target.scoringPeriodId },
				previewMatchups,
				standingsHistory,
				matchupH2H: {},
				teamRecords,
				weekPerformance,
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

		if (weekData?.isPlayoffWeek) {
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

		const matchupH2H: Record<string, { homeWins: number; awayWins: number; ties: number }> = {};
		if (weekData) {
			for (const m of weekData.matchups) {
				if (!m.away) continue;
				const { aWins, bWins, ties } = getH2H(h2hRecords, m.home.teamId, m.away.teamId);
				matchupH2H[m.matchupId] = { homeWins: aWins, awayWins: bWins, ties };
			}
		}

		return {
			availableWeeks: allWeeks,
			weekData,
			isPreviewWeek:  false,
			previewWeekId:  null,
			previewMatchups: [],
			standingsHistory,
			matchupH2H,
			teamRecords,
			weekPerformance
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
			weekPerformance: { perf: {}, currentTeams: [] },
			error: error instanceof Error ? error.message : 'Failed to load data'
		};
	}
}
