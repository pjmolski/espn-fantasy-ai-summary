import { getAllSeasons, getAllMatchupsAllSeasons } from '$lib/fantasyDataService';
import { computePlayoffBracket } from '$lib/playoffBracket';
import { LEAGUE_ID } from '$env/static/private';
import type { WeeklyMatchupDoc } from '$lib/schema';

export async function load() {
	const [allSeasons, allDocs] = await Promise.all([
		getAllSeasons(LEAGUE_ID),   // newest first
		getAllMatchupsAllSeasons(LEAGUE_ID),
	]);

	// ── Name + logo maps ──────────────────────────────────────────────────────
	type TeamMeta = { name: string; logoUrl?: string };
	const seasonMetaMap = new Map<number, Map<number, TeamMeta>>();
	for (const s of allSeasons) {
		const m = new Map<number, TeamMeta>();
		for (const t of s.teams) m.set(t.teamId, { name: t.name, logoUrl: t.logoUrl });
		seasonMetaMap.set(s.seasonId, m);
	}

	const currentTeams = (allSeasons[0]?.teams ?? [])
		.map(t => ({ teamId: t.teamId, name: t.name, logoUrl: t.logoUrl }))
		.sort((a, b) => a.teamId - b.teamId);

	const nameFor = (seasonId: number, teamId: number) =>
		seasonMetaMap.get(seasonId)?.get(teamId)?.name
		?? currentTeams.find(t => t.teamId === teamId)?.name
		?? `Team ${teamId}`;

	const logoFor = (seasonId: number, teamId: number) =>
		seasonMetaMap.get(seasonId)?.get(teamId)?.logoUrl
		?? currentTeams.find(t => t.teamId === teamId)?.logoUrl;

	// ── Group docs by season ──────────────────────────────────────────────────
	const docsBySeason = new Map<number, WeeklyMatchupDoc[]>();
	for (const doc of allDocs) {
		if (!docsBySeason.has(doc.seasonId)) docsBySeason.set(doc.seasonId, []);
		docsBySeason.get(doc.seasonId)!.push(doc);
	}

	// ── Season results (champions + chumpions per season) ────────────────────
	type Finisher = { teamId: number; teamName: string; logoUrl?: string };
	type SeasonResult = {
		seasonId: number;
		championshipWeek: number;
		first?: Finisher;
		second?: Finisher;
		third?: Finisher;
		chumpion?: Finisher;
	};

	const seasonResults: SeasonResult[] = [];
	for (const seasonDoc of allSeasons) {
		const docs = docsBySeason.get(seasonDoc.seasonId) ?? [];
		try {
			const bracket = computePlayoffBracket(docs, seasonDoc);
			const r3 = bracket.rounds.at(-1);
			if (!r3) continue;

			// R3 matchups: [Championship, 3rd Place, Chumpionship, 9th/10th]
			const [champGame, thirdGame, chumpGame] = r3.matchups;

			const finisher = (id: number | null, sId: number): Finisher | undefined =>
				id ? { teamId: id, teamName: nameFor(sId, id), logoUrl: logoFor(sId, id) } : undefined;

			const loserOf = (m: typeof champGame) =>
				m.winner && m.teamIdA && m.teamIdB
					? (m.winner === m.teamIdA ? m.teamIdB : m.teamIdA)
					: null;

			const result: SeasonResult = {
				seasonId: seasonDoc.seasonId,
				championshipWeek: r3.week,
				first:    finisher(champGame?.winner ?? null, seasonDoc.seasonId),
				second:   finisher(loserOf(champGame), seasonDoc.seasonId),
				third:    finisher(thirdGame?.winner ?? null, seasonDoc.seasonId),
				chumpion: finisher(chumpGame?.winner ?? null, seasonDoc.seasonId),
			};
			// Only include seasons with at least a champion
			if (result.first) seasonResults.push(result);
		} catch { /* skip incomplete seasons */ }
	}

	// ── Winningest & chumpiest tallies ────────────────────────────────────────
	const champCount = new Map<number, number>();
	const chumpCount = new Map<number, number>();
	for (const sr of seasonResults) {
		if (sr.first) champCount.set(sr.first.teamId, (champCount.get(sr.first.teamId) ?? 0) + 1);
		if (sr.chumpion) chumpCount.set(sr.chumpion.teamId, (chumpCount.get(sr.chumpion.teamId) ?? 0) + 1);
	}
	const currentLogoFor = (teamId: number) => currentTeams.find(t => t.teamId === teamId)?.logoUrl;
	const currentNameFor = (teamId: number) => currentTeams.find(t => t.teamId === teamId)?.name ?? `Team ${teamId}`;

	const winniestTeams = [...champCount.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([teamId, count]) => ({ teamId, teamName: currentNameFor(teamId), logoUrl: currentLogoFor(teamId), count }));

	const chumpiestTeams = [...chumpCount.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([teamId, count]) => ({ teamId, teamName: currentNameFor(teamId), logoUrl: currentLogoFor(teamId), count }));

	// ── All-time H2H records ──────────────────────────────────────────────────
	type H2HRec = { t1w: number; t2w: number; ties: number };
	const h2hMap = new Map<string, H2HRec>();
	for (const doc of allDocs) {
		for (const m of doc.matchups) {
			if (!m.away || m.winner === 'UNDECIDED') continue;
			const lo = Math.min(m.home.teamId, m.away.teamId);
			const hi = Math.max(m.home.teamId, m.away.teamId);
			const key = `${lo}-${hi}`;
			if (!h2hMap.has(key)) h2hMap.set(key, { t1w: 0, t2w: 0, ties: 0 });
			const rec = h2hMap.get(key)!;
			if (m.winner === 'TIE') { rec.ties++; }
			else {
				const winnerId = m.winner.toLowerCase() === 'home' ? m.home.teamId : m.away.teamId;
				if (winnerId === lo) rec.t1w++; else rec.t2w++;
			}
		}
	}
	const h2hSerialized: Record<string, H2HRec> = Object.fromEntries(h2hMap);

	// ── Rivalry lists ─────────────────────────────────────────────────────────
	const allPairs = [...h2hMap.entries()]
		.map(([key, rec]) => {
			const [lo, hi] = key.split('-').map(Number);
			const total = rec.t1w + rec.t2w + rec.ties;
			return {
				team1Id: lo,
				team1Name: currentNameFor(lo),
				team1Logo: currentLogoFor(lo),
				team2Id: hi,
				team2Name: currentNameFor(hi),
				team2Logo: currentLogoFor(hi),
				wins1: rec.t1w, wins2: rec.t2w, ties: rec.ties, total,
			};
		})
		.filter(r => r.total >= 3);

	const tightestRivalries = [...allPairs]
		.sort((a, b) => {
			const dA = Math.abs(a.wins1 - a.wins2), dB = Math.abs(b.wins1 - b.wins2);
			return dA !== dB ? dA - dB : b.total - a.total;
		})
		.slice(0, 10);

	const lopsidedRivalries = [...allPairs]
		.sort((a, b) => {
			const rA = Math.abs(a.wins1 - a.wins2) / a.total;
			const rB = Math.abs(b.wins1 - b.wins2) / b.total;
			return rB !== rA ? rB - rA : b.total - a.total;
		})
		.slice(0, 10);

	// ── Blowouts & barn burners ───────────────────────────────────────────────
	type GameStat = {
		seasonId: number; week: number;
		winnerName: string; winnerScore: number; winnerLogo?: string;
		loserName: string; loserScore: number; loserLogo?: string;
		delta: number; combined: number;
	};

	const gameStats: GameStat[] = [];
	for (const doc of allDocs) {
		for (const m of doc.matchups) {
			if (!m.away || m.winner === 'UNDECIDED' || m.winner === 'TIE') continue;
			const homeWon = m.winner.toLowerCase() === 'home';
			const [wId, lId] = homeWon ? [m.home.teamId, m.away.teamId] : [m.away.teamId, m.home.teamId];
			const [wScore, lScore] = homeWon ? [m.home.totalPoints, m.away.totalPoints] : [m.away.totalPoints, m.home.totalPoints];
			gameStats.push({
				seasonId: doc.seasonId, week: doc.scoringPeriodId,
				winnerName: nameFor(doc.seasonId, wId), winnerScore: wScore, winnerLogo: logoFor(doc.seasonId, wId),
				loserName:  nameFor(doc.seasonId, lId), loserScore: lScore, loserLogo:  logoFor(doc.seasonId, lId),
				delta: wScore - lScore, combined: wScore + lScore,
			});
		}
	}

	const blowouts    = [...gameStats].sort((a, b) => b.delta    - a.delta).slice(0, 10);
	const barnBurners = [...gameStats].sort((a, b) => b.combined - a.combined).slice(0, 10);

	const earliestSeason = allSeasons.length ? Math.min(...allSeasons.map(s => s.seasonId)) : null;

	return {
		currentTeams,
		earliestSeason,
		seasonResults,
		winniestTeams,
		chumpiestTeams,
		h2hSerialized,
		tightestRivalries,
		lopsidedRivalries,
		blowouts,
		barnBurners,
	};
}
