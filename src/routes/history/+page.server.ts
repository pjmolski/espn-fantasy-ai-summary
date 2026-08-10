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

	const DEFAULT_LOGO = 'https://g.espncdn.com/lm-static/ffl/images/ffl-shield-icon.svg';
	const logoFor = (seasonId: number, teamId: number) =>
		seasonMetaMap.get(seasonId)?.get(teamId)?.logoUrl
		?? currentTeams.find(t => t.teamId === teamId)?.logoUrl
		?? DEFAULT_LOGO;

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
		historical?: boolean;
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

	// ── Static historical seasons (pre-2019, no API data) ────────────────────
	const STATIC_HISTORICAL: SeasonResult[] = [
		{ seasonId: 2018, championshipWeek: 17, historical: true,
		  first:    { teamId: 7,  teamName: 'Dave The Dad',                       logoUrl: 'https://g.espncdn.com/s/ffllm/logos/CatsAndDogs/cats_dogs-2.svg' },
		  second:   { teamId: 6,  teamName: 'GLUEY GIANT SLAYER',                 logoUrl: 'https://g.espncdn.com/s/ffllm/logos/BlitznBears-MartinLaksman/bears-01.svg' },
		  third:    { teamId: 12, teamName: 'Team French',                         logoUrl: DEFAULT_LOGO },
		  chumpion: { teamId: 9,  teamName: 'Gurl Just Wants To Have Fun',         logoUrl: 'https://g.espncdn.com/lm-static/logo-packs/ffl/BlitznBears-MartinLaksman/bears-02.svg' },
		},
		{ seasonId: 2017, championshipWeek: 17, historical: true,
		  first:    { teamId: 3,  teamName: 'King of the Wind',                    logoUrl: DEFAULT_LOGO },
		  second:   { teamId: 8,  teamName: 'Julio Franco, Chipper Jones',         logoUrl: DEFAULT_LOGO },
		  third:    { teamId: 2,  teamName: 'Quarterback Sneak',                   logoUrl: 'https://i.imgur.com/ri3g4hb.png' },
		  chumpion: { teamId: 1,  teamName: 'Clowney McQuestion',                  logoUrl: 'https://i.pinimg.com/736x/dc/3f/e8/dc3fe87bc20e6203b44f168b438691d8---nfl-draft-falcons-football.jpg' },
		},
		{ seasonId: 2016, championshipWeek: 17, historical: true,
		  first:    { teamId: 12, teamName: 'Team French',                         logoUrl: DEFAULT_LOGO },
		  second:   { teamId: 11, teamName: 'Matthew "Ice" Bounty Hunter',         logoUrl: DEFAULT_LOGO },
		  third:    { teamId: 3,  teamName: 'King of the Wind',                    logoUrl: DEFAULT_LOGO },
		  chumpion: { teamId: 1,  teamName: 'Clinty McEastwood',                   logoUrl: 'https://i.pinimg.com/736x/dc/3f/e8/dc3fe87bc20e6203b44f168b438691d8---nfl-draft-falcons-football.jpg' },
		},
		{ seasonId: 2015, championshipWeek: 17, historical: true,
		  first:    { teamId: 8,  teamName: 'Julio "Franco, Chipper" Jones',       logoUrl: DEFAULT_LOGO },
		  second:   { teamId: 6,  teamName: 'Taming of the Glue',                 logoUrl: DEFAULT_LOGO },
		  third:    { teamId: 4,  teamName: "Stafford's Staff",                    logoUrl: DEFAULT_LOGO },
		  chumpion: { teamId: 9,  teamName: 'As Impressive As Declan',             logoUrl: 'https://vignette3.wikia.nocookie.net/christmasspecials/images/a/a3/Yukon.jpg/revision/latest?cb=20120724062049' },
		},
		{ seasonId: 2014, championshipWeek: 17, historical: true,
		  first:    { teamId: 8,  teamName: 'Hash Driveway',                       logoUrl: DEFAULT_LOGO },
		  second:   { teamId: 7,  teamName: 'Dead Wrong Dave',                    logoUrl: DEFAULT_LOGO },
		  third:    { teamId: 11, teamName: 'Eleven Angry Men',                   logoUrl: 'https://i.imgur.com/meH2Y6I.jpg' },
		  chumpion: { teamId: 2,  teamName: 'Intentional Grounding',               logoUrl: 'https://imgur.com/ggxcS4a.jpg' },
		},
		{ seasonId: 2013, championshipWeek: 17, historical: true,
		  first:    { teamId: 9,  teamName: 'Caught Red Hernandez',                logoUrl: DEFAULT_LOGO },
		  second:   { teamId: 5,  teamName: 'Churchill Polar Bears',               logoUrl: 'https://i.imgur.com/COOhSjS.jpg' },
		  third:    { teamId: 1,  teamName: 'Clowny McQuestion',                   logoUrl: DEFAULT_LOGO },
		  chumpion: { teamId: 11, teamName: "Schrodinger's Kaepernick",             logoUrl: 'https://i.imgur.com/O3YkZaw.jpg' },
		},
		{ seasonId: 2012, championshipWeek: 17, historical: true,
		  first:    { teamId: 1,  teamName: 'Cloney McStudent',                    logoUrl: 'https://i.imgur.com/h6lWf.png' },
		  second:   { teamId: 7,  teamName: 'Don Cheadle and the Rice Beds',       logoUrl: 'https://i.imgur.com/YTMR3.gif' },
		  third:    { teamId: 8,  teamName: "My Couch Pulls Out But I Don't",      logoUrl: DEFAULT_LOGO },
		  chumpion: { teamId: 2,  teamName: 'The Abominable Snowmen',              logoUrl: 'https://i.imgur.com/BkE2m.png' },
		},
	];
	seasonResults.push(...STATIC_HISTORICAL);
	seasonResults.sort((a, b) => b.seasonId - a.seasonId);

	// ── Winningest & chumpiest tallies ────────────────────────────────────────
	const champYears = new Map<number, number[]>();
	const chumpYears = new Map<number, number[]>();
	for (const sr of seasonResults) {
		if (sr.first) {
			if (!champYears.has(sr.first.teamId)) champYears.set(sr.first.teamId, []);
			champYears.get(sr.first.teamId)!.push(sr.seasonId);
		}
		if (sr.chumpion) {
			if (!chumpYears.has(sr.chumpion.teamId)) chumpYears.set(sr.chumpion.teamId, []);
			chumpYears.get(sr.chumpion.teamId)!.push(sr.seasonId);
		}
	}
	const currentLogoFor = (teamId: number) => currentTeams.find(t => t.teamId === teamId)?.logoUrl;
	const currentNameFor = (teamId: number) => currentTeams.find(t => t.teamId === teamId)?.name ?? `Team ${teamId}`;

	const winniestTeams = [...champYears.entries()]
		.sort((a, b) => b[1].length - a[1].length)
		.map(([teamId, years]) => ({ teamId, teamName: currentNameFor(teamId), logoUrl: currentLogoFor(teamId), count: years.length, years: [...years].sort((a, b) => a - b) }));

	const chumpiestTeams = [...chumpYears.entries()]
		.sort((a, b) => b[1].length - a[1].length)
		.map(([teamId, years]) => ({ teamId, teamName: currentNameFor(teamId), logoUrl: currentLogoFor(teamId), count: years.length, years: [...years].sort((a, b) => a - b) }));

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

	const earliestSeason = null; // Full history back to 2012 via static data

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
