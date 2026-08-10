import { getAllSeasons, getAllMatchupsAllSeasons } from '$lib/fantasyDataService';
import { computePlayoffBracket } from '$lib/playoffBracket';
import { LEAGUE_ID } from '$env/static/private';
import type { WeeklyMatchupDoc } from '$lib/schema';

export async function load() {
	const [allSeasons, allDocs] = await Promise.all([
		getAllSeasons(LEAGUE_ID),
		getAllMatchupsAllSeasons(LEAGUE_ID),
	]);

	// Build seasonId → teamId → name map
	const seasonNameMap = new Map<number, Map<number, string>>();
	for (const s of allSeasons) {
		const m = new Map<number, string>();
		for (const t of s.teams) m.set(t.teamId, t.name);
		seasonNameMap.set(s.seasonId, m);
	}

	// Current team list = most recent season (allSeasons sorted desc)
	const currentTeams = (allSeasons[0]?.teams ?? [])
		.map(t => ({ teamId: t.teamId, name: t.name }))
		.sort((a, b) => a.teamId - b.teamId);

	const nameFor = (seasonId: number, teamId: number) =>
		seasonNameMap.get(seasonId)?.get(teamId)
		?? currentTeams.find(t => t.teamId === teamId)?.name
		?? `Team ${teamId}`;

	// Group docs by season
	const docsBySeason = new Map<number, WeeklyMatchupDoc[]>();
	for (const doc of allDocs) {
		if (!docsBySeason.has(doc.seasonId)) docsBySeason.set(doc.seasonId, []);
		docsBySeason.get(doc.seasonId)!.push(doc);
	}

	// Champions & chumpions per completed season
	type SeasonWinner = { seasonId: number; teamId: number; teamName: string; championshipWeek: number };
	const champions: SeasonWinner[] = [];
	const chumpions: SeasonWinner[] = [];

	for (const seasonDoc of allSeasons) {
		const docs = docsBySeason.get(seasonDoc.seasonId) ?? [];
		try {
			const bracket = computePlayoffBracket(docs, seasonDoc);
			const finalRound = bracket.rounds.at(-1);
			if (!finalRound) continue;
			const champWeek = finalRound.week;
			for (const m of finalRound.matchups) {
				if (!m.winner) continue;
				if (m.placesAtStake[0] === 1) {
					champions.push({ seasonId: seasonDoc.seasonId, teamId: m.winner, teamName: nameFor(seasonDoc.seasonId, m.winner), championshipWeek: champWeek });
				} else if (m.placesAtStake[0] === 7) {
					chumpions.push({ seasonId: seasonDoc.seasonId, teamId: m.winner, teamName: nameFor(seasonDoc.seasonId, m.winner), championshipWeek: champWeek });
				}
			}
		} catch { /* skip seasons with incomplete bracket data */ }
	}

	// All-time H2H records
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

	// Rivalry lists
	const allPairs = [...h2hMap.entries()]
		.map(([key, rec]) => {
			const [lo, hi] = key.split('-').map(Number);
			const total = rec.t1w + rec.t2w + rec.ties;
			return {
				team1Id: lo, team1Name: currentTeams.find(t => t.teamId === lo)?.name ?? `Team ${lo}`,
				team2Id: hi, team2Name: currentTeams.find(t => t.teamId === hi)?.name ?? `Team ${hi}`,
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

	// Blowouts & barn burners
	type GameStat = {
		seasonId: number; week: number;
		winnerName: string; winnerScore: number;
		loserName: string; loserScore: number;
		delta: number; combined: number;
	};

	const gameStats: GameStat[] = [];
	for (const doc of allDocs) {
		for (const m of doc.matchups) {
			if (!m.away || m.winner === 'UNDECIDED' || m.winner === 'TIE') continue;
			const homeWon = m.winner.toLowerCase() === 'home';
			const [winnerId, loserId] = homeWon ? [m.home.teamId, m.away.teamId] : [m.away.teamId, m.home.teamId];
			const [wScore, lScore] = homeWon ? [m.home.totalPoints, m.away.totalPoints] : [m.away.totalPoints, m.home.totalPoints];
			gameStats.push({
				seasonId: doc.seasonId, week: doc.scoringPeriodId,
				winnerName: nameFor(doc.seasonId, winnerId), winnerScore: wScore,
				loserName: nameFor(doc.seasonId, loserId), loserScore: lScore,
				delta: wScore - lScore, combined: wScore + lScore,
			});
		}
	}

	const blowouts = [...gameStats].sort((a, b) => b.delta - a.delta).slice(0, 10);
	const barnBurners = [...gameStats].sort((a, b) => b.combined - a.combined).slice(0, 10);

	return {
		currentTeams,
		champions,
		chumpions,
		h2hSerialized,
		tightestRivalries,
		lopsidedRivalries,
		blowouts,
		barnBurners,
	};
}
