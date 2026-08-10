<script lang="ts">
	import type { ProcessedWeek, ProcessedMatchup, ProcessedTeam, ProcessedPlayer } from '$lib/weekProcessor';
	import type { StandingsEntry } from '$lib/standingsHistory';
	import { goto, afterNavigate } from '$app/navigation';
	import { navigating } from '$app/stores';

	export let data: {
		availableWeeks: Array<{ seasonId: number; scoringPeriodId: number; isPlayoff: boolean; isPreview?: boolean }>;
		weekData: ProcessedWeek | null;
		isPreviewWeek: boolean;
		previewWeekId: { seasonId: number; scoringPeriodId: number } | null;
		previewMatchups: Array<{
			matchupId: number;
			playoffTierType: string;
			home: {
				teamId: number; teamName: string; ownerName: string; logoUrl?: string;
				projectedPoints: number; winProbability: number;
				starters: Array<{ playerId: number; fullName: string; position: string; slotName: string; nflTeam: string; lineupSlotId: number; isStarter: boolean; projectedScore: number; projectedCeiling: number; injuryStatus: string }>;
				bench: Array<{ playerId: number; fullName: string; position: string; slotName: string; nflTeam: string; lineupSlotId: number; isStarter: boolean; projectedScore: number; projectedCeiling: number; injuryStatus: string }>;
				optimalStarters: Array<{ playerId: number; fullName: string; position: string; slotName: string; nflTeam: string; lineupSlotId: number; isStarter: boolean; projectedScore: number; projectedCeiling: number; injuryStatus: string }>;
				projectedOptimalPoints: number;
			};
			away?: {
				teamId: number; teamName: string; ownerName: string; logoUrl?: string;
				projectedPoints: number; winProbability: number;
				starters: Array<{ playerId: number; fullName: string; position: string; slotName: string; nflTeam: string; lineupSlotId: number; isStarter: boolean; projectedScore: number; projectedCeiling: number; injuryStatus: string }>;
				bench: Array<{ playerId: number; fullName: string; position: string; slotName: string; nflTeam: string; lineupSlotId: number; isStarter: boolean; projectedScore: number; projectedCeiling: number; injuryStatus: string }>;
				optimalStarters: Array<{ playerId: number; fullName: string; position: string; slotName: string; nflTeam: string; lineupSlotId: number; isStarter: boolean; projectedScore: number; projectedCeiling: number; injuryStatus: string }>;
				projectedOptimalPoints: number;
			};
			h2h?: { homeWins: number; awayWins: number; ties: number };
		}>;
		standingsHistory: StandingsEntry[];
		matchupH2H: Record<string, { homeWins: number; awayWins: number; ties: number }>;
		teamRecords: Record<number, { wins: number; losses: number }>;
		error?: string;
	};

	let weekData: ProcessedWeek | null = data.weekData;
	let standingsHistory: StandingsEntry[] = data.standingsHistory ?? [];
	$: matchupH2H = data.matchupH2H ?? {};
	$: teamRecords = data.teamRecords ?? {};
	$: teamRanks = new Map(standingsHistory.map(e => {
		const r = [...e.weeklyRanks].reverse().find(wr => wr.week <= selectedWeek);
		return [e.teamId, r?.rank ?? null] as [number, number | null];
	}).filter(([, r]) => r !== null));


	let selectedSeason: number = data.weekData?.seasonId ?? data.availableWeeks[0]?.seasonId;
	let selectedWeek: number = data.weekData?.scoringPeriodId ?? data.availableWeeks[0]?.scoringPeriodId;

	// Sync reactive state when server load re-runs after navigation
	$: {
		weekData = data.weekData;
		standingsHistory = data.standingsHistory ?? [];
		if (data.weekData) {
			selectedSeason = data.weekData.seasonId;
			selectedWeek = data.weekData.scoringPeriodId;
			showOptimal = {};
			benchOpen = {};
		}
	}

	$: loading = !!$navigating;


	// Notify parent frame so it can sync its own URL (pjmolski.com/ff?season=X&week=Y)
	afterNavigate(({ to }) => {
		const params = to?.url?.searchParams ?? new URLSearchParams(window.location.search);
		const season = params.get('season');
		const week = params.get('week');
		if (season && week) {
			try { window.parent.postMessage({ type: 'ff-nav', season: +season, week: +week }, '*'); } catch {}
		}
		// Scroll to anchor if present (e.g. from H2H row click)
		const hash = to?.url?.hash ?? window.location.hash;
		if (hash) {
			setTimeout(() => {
				const el = document.getElementById(hash.slice(1));
				if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}, 100);
		}
	});

	$: weeksBySeason = groupWeeksBySeason(data.availableWeeks);
	$: seasons = [...(weeksBySeason?.keys() ?? [])].sort((a, b) => b - a);
	$: weeksForSeason = (weeksBySeason.get(selectedSeason) ?? []).slice().reverse();

	function groupWeeksBySeason(weeks: typeof data.availableWeeks) {
		const map = new Map<number, typeof data.availableWeeks>();
		for (const w of weeks) {
			if (!map.has(w.seasonId)) map.set(w.seasonId, []);
			map.get(w.seasonId)!.push(w);
		}
		return map;
	}

	function onSeasonChange() {
		const weeks = weeksBySeason.get(selectedSeason) ?? [];
		if (weeks.length > 0) {
			goto(`?season=${selectedSeason}&week=${weeks[0].scoringPeriodId}`);
		}
	}

	function onWeekChange() {
		goto(`?season=${selectedSeason}&week=${selectedWeek}`);
	}

	// Genie toggle state per matchup
	let showOptimal: Record<number, boolean> = {};
	function toggleOptimal(matchupId: number) {
		showOptimal = { ...showOptimal, [matchupId]: !showOptimal[matchupId] };
	}

	// Bench open/closed per matchup (shared for both teams)
	let benchOpen: Record<number, boolean> = {};
	function toggleBench(matchupId: number) {
		benchOpen = { ...benchOpen, [matchupId]: !benchOpen[matchupId] };
	}

	// H2H history subsection
	let h2hOpen: Record<number, boolean> = {};
	let h2hHistory: Record<number, any[]> = {};
	async function toggleH2H(matchupId: number) {
		h2hOpen = { ...h2hOpen, [matchupId]: !h2hOpen[matchupId] };
		if (h2hOpen[matchupId] && !h2hHistory[matchupId]) {
			const m = weekData?.matchups.find(x => x.matchupId === matchupId);
			if (!m?.away) return;
			const res = await fetch(`/api/h2h?team1=${m.home.teamId}&team2=${m.away.teamId}`);
			const d = await res.json();
			h2hHistory = { ...h2hHistory, [matchupId]: d.matchups ?? [] };
		}
	}

	function ordinal(n: number) {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	}

	function sign(n: number) { return n >= 0 ? '+' : ''; }

	function optimalWouldWin(team: ProcessedTeam, matchup: ProcessedMatchup): boolean {
		const opp = team === matchup.home ? (matchup.away?.totalPoints ?? 0) : matchup.home.totalPoints;
		return team.optimalPoints > opp;
	}

	function teamActuallyWon(team: ProcessedTeam, matchup: ProcessedMatchup): boolean {
		return (team === matchup.home && matchup.winner === 'home') ||
			   (team === matchup.away && matchup.winner === 'away');
	}

	const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];
	const OPT_POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];
	function sortOptimalPlayers(players: ProcessedPlayer[]) {
		return [...players].sort((a, b) => {
			const ai = OPT_POS_ORDER.indexOf(a.slotName);
			const bi = OPT_POS_ORDER.indexOf(b.slotName);
			if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
			return b.actualScore - a.actualScore;
		});
	}

	// Muscle 💪 = highest scorer across all starters this week
	// Poop 💩 = lowest scorer (DST excluded) across all starters this week

	$: topScore = weekData
		? Math.max(...weekData.matchups.flatMap(m => [m.home.totalPoints, m.away?.totalPoints ?? 0]))
		: -Infinity;
	$: bottomScore = weekData
		? Math.min(...weekData.matchups.flatMap(m => [m.home.totalPoints, m.away?.totalPoints ?? Infinity]))
		: Infinity;

	// Team award emoji map: teamId → emoji[]
	$: teamAwardMap = (() => {
		const map = new Map<number, string[]>();
		if (!weekData) return map;
		const add = (teamId: number | null | undefined, emoji: string) => {
			if (teamId == null) return;
			if (!map.has(teamId)) map.set(teamId, []);
			map.get(teamId)!.push(emoji);
		};
		if (weekData.superMushroom) add(weekData.superMushroom.teamId, '🍄');
		if (weekData.closeShave) add(weekData.closeShave.teamId, '💈');
		for (const a of weekData.assassins ?? []) add(a.teamId, '🥷');
		if (weekData.gambler) add(weekData.gambler.teamId, '🎲');
		if (weekData.wrongMan) add(weekData.wrongMan.teamId, '👥');
		if (weekData.luckyDevil) add(weekData.luckyDevil.teamId, '🍀');
		if (weekData.mrMonopoly) add(weekData.mrMonopoly.teamId, '🎩');
		if (weekData.hotRod) add(weekData.hotRod.teamId, '🏎️');
		if (weekData.snowMan) add(weekData.snowMan.teamId, '⛄');
		if (weekData.brassNuts) add(weekData.brassNuts.teamId, '🔩');
		if (weekData.toiletBowl) add(weekData.toiletBowl.teamId, '🪠');
		return map;
	})();

	let legendOpen = false;
	let honorsOpen = true;
	let studsOpen = true;
	let matchupsOpen = true;

	function displacedFromOptimal(t: ProcessedTeam): ProcessedPlayer[] {
		const optIds = new Set(t.optimalStarters.map(s => s.playerId));
		return [...t.starters, ...t.bench].filter(p => !optIds.has(p.playerId) && p.slotName !== 'IR');
	}

	function sortPlayers(players: ProcessedPlayer[]) {
		return [...players].sort((a, b) => SLOT_ORDER.indexOf(a.slotName) - SLOT_ORDER.indexOf(b.slotName));
	}

	function playerImgUrl(playerId: number, position: string, nflTeam: string): string {
		if (position === 'D/ST') return `https://a.espncdn.com/i/teamlogos/nfl/500/${nflTeam.toLowerCase()}.png`;
		return `https://a.espncdn.com/i/headshots/nfl/players/full/${playerId}.png`;
	}

	$: teamLogoMap = (() => {
		const map = new Map<number, string>();
		if (!weekData) return map;
		for (const m of weekData.matchups) {
			if (m.home.logoUrl) map.set(m.home.teamId, m.home.logoUrl);
			if (m.away?.logoUrl) map.set(m.away.teamId, m.away.logoUrl);
		}
		return map;
	})();
	// ── Standings chart ──────────────────────────────────────────────────────────
	let standingsOpen = true;

	const CHART_COLORS = [
		'#ff6b6b', '#ff9f43', '#ffd32a', '#48dbfb',
		'#54a0ff', '#5f27cd', '#ff9ff3', '#1dd1a1',
		'#00d2d3', '#a29bfe', '#fd79a8', '#b8e994'
	];

	const PAD_L = 52, PAD_T = 16, PAD_R = 20, PAD_B = 36;
	const SVG_W = 800, SVG_H = 340;
	const PLOT_W = SVG_W - PAD_L - PAD_R;
	const PLOT_H = SVG_H - PAD_T - PAD_B;

	$: chartInfo = buildChart(standingsHistory);

	function buildChart(history: import('$lib/standingsHistory').StandingsEntry[]) {
		if (!history.length) return null;
		const allWeeks = [...new Set(history.flatMap(e => e.weeklyRanks.map(r => r.week)))].sort((a, b) => a - b);
		// X-axis always spans the full season regardless of which week is selected.
		const seasonMaxWeek = Math.max(
			...data.availableWeeks.filter(w => w.seasonId === selectedSeason).map(w => w.scoringPeriodId),
			1
		);
		const maxWeek = seasonMaxWeek;
		const maxRank = Math.max(...history.map(e => e.weeklyRanks.length > 0 ? Math.ceil(Math.max(...e.weeklyRanks.map(r => r.rank))) : 1));

		const xFor = (w: number) => PAD_L + (maxWeek > 0 ? (w / maxWeek) * PLOT_W : 0);
		const yFor = (r: number) => PAD_T + ((r - 1) / Math.max(maxRank - 1, 1)) * PLOT_H;

		// Determine where playoffs start (first week where isPlayoff, from availableWeeks)
		const playoffStartWeek = (() => {
			const playoffWeeks = data.availableWeeks
				.filter(w => w.isPlayoff && w.seasonId === selectedSeason)
				.map(w => w.scoringPeriodId);
			return playoffWeeks.length ? Math.min(...playoffWeeks) : null;
		})();

		const gridRanks = Array.from({ length: maxRank }, (_, i) => i + 1);

		return {
			allWeeks, maxWeek, maxRank,
			xFor, yFor, gridRanks,
			playoffStartWeek,
			teams: history.map((entry, i) => {
				const pts = entry.weeklyRanks.map(r => `${xFor(r.week).toFixed(1)},${yFor(r.rank).toFixed(1)}`);
				const d = pts.length > 1 ? 'M ' + pts.join(' L ') : '';
				const rankAt = (w: number) => entry.weeklyRanks.find(r => r.week === w)?.rank;
				const clinchX = entry.clinchWeek      != null ? xFor(entry.clinchWeek)      : null;
				const clinchY = entry.clinchWeek      != null && rankAt(entry.clinchWeek)      != null ? yFor(rankAt(entry.clinchWeek)!)      : null;
				const elimX   = entry.eliminationWeek != null ? xFor(entry.eliminationWeek) : null;
				const elimY   = entry.eliminationWeek != null && rankAt(entry.eliminationWeek) != null ? yFor(rankAt(entry.eliminationWeek)!) : null;
				return { ...entry, d, color: CHART_COLORS[i % CHART_COLORS.length], clinchX, clinchY, elimX, elimY };
			})
		};
	}

</script>

<svelte:head>
	<title>Fantasy Football</title>
</svelte:head>

<style>
	:global(*) { box-sizing: border-box; margin: 0; padding: 0; }
	:global(:root) { --gold: #ffcc33; --green: #00d26d; --red: #ff5a46; }
	:global(body) {
		font-family: 'Raleway', sans-serif;
		background: #303030;
		color: #ffffff;
		font-size: 15px;
		line-height: 1.6;
		-webkit-font-smoothing: antialiased;
	}

	.page { min-height: 100vh; }

	/* Top bar — just the selects */
	.top-bar {
		background: #1e1e1e;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		padding: 12px 40px;
	}
	.selects { display: flex; gap: 10px; flex-wrap: wrap; }
	select {
		background: #272727;
		border: 1px solid rgba(255,255,255,0.12);
		color: #fff;
		font-family: 'Raleway', sans-serif;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.5px;
		padding: 6px 12px;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
		transition: border-color .18s;
	}
	select:focus { border-color: var(--green); }

	/* Main */
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 32px 40px 80px;
	}

	.section-header {
		font-size: 28px;
		font-weight: 200;
		letter-spacing: -0.5px;
		color: var(--green);
		margin: 40px 0 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid rgba(0,210,109,0.2);
		cursor: pointer;
		user-select: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.section-header:hover { opacity: 0.85; }
	.section-chevron { margin-left: 10px; font-size: 22px; opacity: 0.85; color: var(--green); display: inline-block; transition: transform 0.2s; line-height: 1; }
	.section-chevron::before { content: "›"; }
	.section-chevron.open { transform: rotate(90deg); }
	.week-label {
		font-size: 11px;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: rgba(255,255,255,0.4);
		margin-bottom: 24px;
	}
	.preview-label { color: rgba(255, 204, 51, 0.6); }

	/* Preview matchup card */
	.preview-card .matchup-header { flex-direction: column; align-items: stretch; gap: 10px; }
	.preview-proj { color: var(--gold) !important; font-size: 20px !important; }
	.win-prob-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.win-prob-bar {
		flex: 1;
		height: 6px;
		background: rgba(255,90,70,0.5);
		border-radius: 3px;
		overflow: hidden;
	}
	.prob-home {
		height: 100%;
		background: var(--green);
		border-radius: 3px;
		transition: width 0.3s ease;
	}
	.win-prob-pct {
		font-size: 11px;
		font-weight: 600;
		min-width: 32px;
	}
	.home-pct { color: var(--green); text-align: left; }
	.away-pct { color: var(--red);   text-align: right; }

	/* Matchup card */
	.matchup-card {
		background: #272727;
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 3px;
		margin-bottom: 16px;
		overflow: hidden;
	}

	.matchup-header {
		background: #1e1e1e;
		padding: 14px 20px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		border-bottom: 1px solid rgba(255,255,255,0.08);
	}

	.score-line { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
	.team-score { display: flex; align-items: center; gap: 8px; }
	.team-name {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.3px;
	}
	.team-name.winner { color: #fff; }
	.team-name.top-scorer { color: var(--gold); }
	.cake-opt-delta {
		font-size: 12px;
		font-weight: 700;
		color: var(--gold);
		letter-spacing: 0;
	}
	.bench-left { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
	.team-name.loser  { color: rgba(255,255,255,0.45); }
	.score {
		font-size: 20px;
		font-weight: 200;
		letter-spacing: -0.5px;
	}
	.score.winner { color: var(--green); }
	.score.loser  { color: rgba(255,255,255,0.35); }
	.team-name.bottom-scorer { color: #8B4513 !important; font-weight: 700; }
	.score.bottom-scorer { color: #8B4513 !important; font-weight: 700; }
	.vs { font-size: 11px; color: rgba(255,255,255,0.25); letter-spacing: 1px; text-transform: uppercase; }

	/* Tab buttons */
	.cake-btn {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 2px solid rgba(255,255,255,0.15);
		background: rgba(255,255,255,0.06);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		padding: 0;
		transition: border-color .18s, background .18s, box-shadow .18s;
		flex-shrink: 0;
	}
	.cake-btn:hover {
		border-color: rgba(255,255,255,0.35);
	}
	.cake-btn.active {
		border-color: var(--gold);
		background: rgba(255,204,51,0.1);
		box-shadow: 0 0 0 3px rgba(255,204,51,0.15);
	}

	/* Roster grid */
	.roster-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0;
	}
	@media (max-width: 640px) { .roster-grid { grid-template-columns: 1fr; } }

	.team-col { padding: 16px 20px; }
	.team-col:first-child { border-right: 1px solid rgba(255,255,255,0.06); }

	.col-header {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin-bottom: 10px;
	}
	.col-team-name { font-size: 12px; font-weight: 700; letter-spacing: 0.5px; color: rgba(255,255,255,0.7); }
	.col-meta { font-size: 11px; color: rgba(255,255,255,0.3); }
	.col-meta .bench-pts { color: var(--gold); }

	/* Player rows */
	.player-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 5px 6px;
		font-size: 13px;
		border-radius: 2px;
	}
	.player-row:nth-child(odd)  { background: rgba(255,255,255,0.03); }
	.player-row:nth-child(even) { background: transparent; }

	.player-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
	.slot-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 1px;
		color: rgba(255,255,255,0.3);
		text-transform: uppercase;
		width: 36px;
		flex-shrink: 0;
	}
	.player-name { color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.nfl-team {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #ffffff4d;
		flex-shrink: 0;
	}
	.injury-badge {
		font-size: 14px;
		font-weight: 700;
		padding: 1px 4px;
		border-radius: 2px;
		flex-shrink: 0;
	}
	.injury-badge.out  { background: rgba(255,90,70,0.2);  color: var(--red); }
	.injury-badge.q    { background: rgba(255,200,50,0.2); color: var(--gold); }

	.player-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: 6px; }
	.proj { font-size: 11px; color: rgba(255,255,255,0.25); }
	.actual {
		font-size: 13px;
		font-weight: 600;
		width: 48px;
		text-align: right;
	}
	.actual.over  { color: var(--green); }
	.actual.under { color: var(--red); }
	.actual.norm  { color: rgba(255,255,255,0.8); }

	/* Would-have-beaten */
	.whb {
		margin-top: 10px;
		font-size: 11px;
		color: rgba(255,255,255,0.3);
		letter-spacing: 0.3px;
	}
	.whb strong { color: rgba(255,255,255,0.7); }
	.lucky-tag { color: var(--green); }

	/* Bench toggle */
	.total-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 6px 4px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: rgba(255,255,255,0.45);
		border-top: 1px solid rgba(255,255,255,0.1);
		margin-top: 2px;
	}
	.total-right { display: flex; gap: 8px; align-items: center; }
	.total-right .proj { font-size: 11px; }
	.total-right .actual { font-size: 13px; font-weight: 700; width: 48px; text-align: right; }
	.proj-total { color: rgba(255,255,255,0.3); }
	.bench-row.displaced { color: rgba(255,200,50,0.6); }
	.award-emoji-inline {
		font-size: 12px;
		line-height: 1;
		flex-shrink: 0;
	}

	.bench-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		background: none;
		border: none;
		color: rgba(255,255,255,0.25);
		font-family: 'Raleway', sans-serif;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		cursor: pointer;
		padding: 0;
		transition: color .15s;
	}
	.bench-toggle:hover { color: rgba(255,255,255,0.5); }
	.bench-section { margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 4px; }
	.bench-row {
		display: flex;
		justify-content: space-between;
		padding: 4px 6px;
		font-size: 12px;
		color: rgba(255,255,255,0.35);
	}
	.bench-row:nth-child(odd) { background: rgba(255,255,255,0.02); }

		/* H2H history subsection */
	.h2h-section { border-top: 1px solid rgba(255,255,255,0.06); margin-top: 4px; }
	.h2h-toggle { width: 100%; display: flex; align-items: center; gap: 8px; background: none; border: none; color: rgba(255,255,255,0.45); font-size: 12px; font-family: inherit; cursor: pointer; padding: 10px 20px; text-align: left; }
	.h2h-toggle:hover { color: rgba(255,255,255,0.7); }
	.h2h-summary { flex: 1; font-weight: 600; color: rgba(255,255,255,0.6); }
	.h2h-chevron { font-size: 16px; transition: transform 0.15s; color: rgba(255,255,255,0.3); }
	.h2h-loading { padding: 12px 20px; font-size: 12px; color: rgba(255,255,255,0.3); }
	.h2h-list { padding: 0 12px 10px; display: flex; flex-direction: column; gap: 2px; }
	.h2h-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 4px; text-decoration: none; color: inherit; }
	.h2h-row:hover { background: rgba(255,255,255,0.05); }
	.h2h-meta { font-size: 11px; color: rgba(255,255,255,0.3); min-width: 80px; white-space: nowrap; }
	.h2h-teams { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; }
	.h2h-winner { font-weight: 700; color: rgba(255,255,255,0.85); }
	.h2h-loser { color: rgba(255,255,255,0.3); }
	.h2h-score { color: rgba(255,255,255,0.4); font-size: 11px; white-space: nowrap; }
		.matchup-card.optimal-mode { background: rgba(255,204,51,0.04); border-color: rgba(255,204,51,0.25); }
	.matchup-card.optimal-mode .matchup-header { background: rgba(40,30,0,0.7); border-bottom-color: rgba(255,204,51,0.15); }
	.bracket-label { font-size: 10px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase; color: var(--dim); opacity: 0.7; margin-bottom: 6px; }
	.vacation-section { margin-bottom: 20px; }
	.vacation-header { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--dim); opacity: 0.6; margin-bottom: 10px; }
	.vacation-cards { display: flex; flex-wrap: wrap; gap: 10px; }
	.vacation-card { background: #1e1e1e; border: 1px solid rgba(255,255,255,0.07); border-radius: 3px; padding: 8px 14px; display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--dim); opacity: 0.75; }
	.team-record { font-size: 12px; color: var(--dim); font-weight: 400; }
	.team-rank { font-size: 10px; font-weight: 700; background: rgba(255,255,255,0.07); border-radius: 2px; padding: 1px 5px; color: var(--dim); }
	.vacation-seed { font-size: 10px; font-weight: 700; background: rgba(255,255,255,0.07); border-radius: 2px; padding: 1px 5px; color: var(--dim); }

	/* Optimal highlight */
	.was-benched { background: rgba(255,200,50,0.07) !important; }
	.was-benched .player-name { color: var(--gold); }
	.benched-tag { font-size: 9px; color: var(--gold); font-weight: 700; letter-spacing: 0.5px; }

	/* Optimal outcome line */
	.opt-outcome {
		margin-top: 8px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.3px;
	}
	.opt-outcome.would-win { color: var(--green); }
	.opt-outcome.would-lose { color: var(--red); }

	/* Awards */
	.awards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 40px; }
	@media (max-width: 640px) { .awards { grid-template-columns: 1fr; } }
	.award-img {
		width: 48px;
		height: 48px;
		object-fit: cover;
		border-radius: 50%;
		background: rgba(255,255,255,0.06);
		flex-shrink: 0;
		align-self: auto;
	}
	.award-img.team-logo {
		border-radius: 6px;
		object-fit: contain;
		background: transparent;
	}
	.award-band { border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 6px; padding-bottom: 4px; }
	.award-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.award-card-inner { display: flex; gap: 10px; align-items: flex-start; clear: both; }
		.award-card {
		background: #272727;
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 3px;
		padding: 8px 12px;
	}
	.award-card.good   { border-left: 3px solid var(--green); }
	.award-card.bad    { border-left: 3px solid var(--red); }
	.award-card.trophy { border-left: 3px solid var(--gold); }

	.award-emoji { font-size: 16px; display: inline-block; margin: 0 14px 0 10px; }
	.award-label {
		display: inline-block;
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: var(--gold);
		margin-bottom: 0;
	}
	.award-card.good   .award-label { color: var(--green); }
	.award-card.bad    .award-label { color: var(--red); }
	.award-card.trophy .award-label { color: var(--gold); }
	.award-player { font-size: 12px; font-weight: 600; }
	.award-meta { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 0; }
	.award-score { font-size: 22px; font-weight: 100; letter-spacing: -0.5px; margin-top: 8px; }
	.award-score.green { color: var(--green); }
	.award-score.red   { color: var(--red); }
	.award-delta { font-size: 11px; margin-top: 2px; color: rgba(255,255,255,0.35); }
	.award-delta .green { color: var(--green); }
	.award-delta .red   { color: var(--red); }

	.empty { text-align: center; padding: 80px 20px; color: rgba(255,255,255,0.25); font-size: 14px; }



	/* Team award badges */
	.team-score { display: flex; align-items: center; gap: 4px; }
	.team-award-badge {
		font-size: 14px;
		line-height: 1;
		opacity: 0.9;
		cursor: default;
	}
	.team-award-badge.sm { font-size: 11px; }

	/* Weekly Studs */
	.studs-section { margin: 32px 0 0; }
	.stud-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
	.stud-row:last-child { border-bottom: none; }
	.stud-rank { font-size: 11px; color: rgba(255,255,255,0.3); width: 24px; text-align: center; flex-shrink: 0; }
	.stud-rank.medal { font-size: 16px; color: rgba(255,255,255,1); }
	.stud-img { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; background: rgba(255,255,255,0.06); flex-shrink: 0; }
	.stud-img.dst { border-radius: 4px; object-fit: contain; background: transparent; }
	.stud-info { flex: none; }
	.stud-name-line { display: flex; align-items: center; gap: 6px; }
	.stud-name { font-size: 13px; color: rgba(255,255,255,0.9); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.stud-pos { font-size: 10px; font-weight: 700; letter-spacing: 0.5px; flex-shrink: 0; }
	.stud-pos.QB { color: var(--green); }
	.stud-pos.RB { color: #4da6ff; }
	.stud-pos.WR { color: var(--red); }
	.stud-pos.TE { color: #f5c518; }
	.stud-pos.DST, .stud-pos.K { color: rgba(255,255,255,0.35); }
	.stud-nfl { font-size: 11px; color: rgba(255,255,255,0.3); flex-shrink: 0; }
	.stud-score { font-size: 13px; font-weight: 600; color: #fff; width: 46px; text-align: right; flex-shrink: 0; }
	.stud-owner { font-size: 11px; color: rgba(255,255,255,0.35); flex: 1; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	/* Award legend */
	.legend-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 6px;
		padding: 10px 16px;
		margin-bottom: 24px;
	}
	.legend-card summary {
		cursor: pointer;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: rgba(255,255,255,0.35);
		user-select: none;
		list-style: none;
	}
	.legend-card summary::before { content: '▸ '; }
	.legend-card[open] summary::before { content: '▾ '; }
	.legend-grid {
		display: grid;
		grid-template-columns: 24px 1fr;
		gap: 6px 10px;
		margin-top: 10px;
		font-size: 12px;
		color: rgba(255,255,255,0.55);
		line-height: 1.4;
	}
	.legend-grid span:first-child { font-size: 14px; line-height: 1; padding-top: 1px; }
	.legend-grid strong { color: rgba(255,255,255,0.8); }
	/* ── Standings chart ──────────────────────────────────────────────────────── */
	.standings-chart-wrap {
		margin-bottom: 48px;
	}
	.standings-svg {
		width: 100%;
		height: auto;
		display: block;
		overflow: visible;
	}
	.chart-grid-line {
		stroke: rgba(255,255,255,0.06);
		stroke-width: 1;
	}
	.chart-grid-line-playoff {
		stroke: rgba(255,204,51,0.12);
		stroke-width: 1;
	}
	.chart-marker { font-size: 9px; pointer-events: none; }
	.chart-marker { font-size: 9px; pointer-events: none; }
	.chart-playoff-bg {
		fill: rgba(255,204,51,0.04);
	}
	.chart-axis-label {
		fill: rgba(255,255,255,0.25);
		font-size: 10px;
		font-family: inherit;
	}
	.chart-team-line {
		fill: none;
		stroke-width: 2;
		opacity: 0.7;
		transition: opacity 0.15s, stroke-width 0.15s;
		cursor: pointer;
	}
	.chart-team-line:hover {
		opacity: 1;
		stroke-width: 3;
	}
	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		margin-top: 12px;
	}
	.chart-legend-item {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: rgba(255,255,255,0.55);
		cursor: default;
	}
	.chart-legend-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.chart-week-label {
		fill: rgba(255,255,255,0.2);
		font-size: 9px;
		text-anchor: middle;
		font-family: inherit;
	}
	.chart-playoff-label {
		fill: rgba(255,204,51,0.4);
		font-size: 9px;
		text-anchor: middle;
		font-family: inherit;
		font-weight: 700;
		letter-spacing: 1px;
	}

</style>

<div class="page">
	<div class="top-bar">
		<div class="selects">
			<select bind:value={selectedSeason} onchange={onSeasonChange}>
				{#each seasons as s}
					<option value={s}>{s} Season</option>
				{/each}
			</select>
			<select bind:value={selectedWeek} onchange={onWeekChange}>
				{#each weeksForSeason as w}
					<option value={w.scoringPeriodId}>{w.isPreview ? '⏳ ' : w.isPlayoff ? '🏆 ' : ''}Week {w.scoringPeriodId}{w.isPreview ? ' (Preview)' : ''}</option>
				{/each}
			</select>
		</div>
	</div>

	<main>
		{#if data.error}
			<div class="empty">{data.error}</div>

		{:else if loading}
			<div class="empty">Loading...</div>

		{:else if weekData}
			<div class="week-label">
				{weekData.seasonId} · {weekData.isPlayoffWeek ? '🏆 Playoffs · ' : ''}Week {weekData.scoringPeriodId}
			</div>

			<h2 class="section-header" onclick={() => honorsOpen = !honorsOpen}>
				<span>Week {weekData.scoringPeriodId} Honors</span>
				<span class="section-chevron {honorsOpen ? 'open' : ''}"></span>
			</h2>

			{#if honorsOpen}
			<div class="awards">
				{#if weekData.brassNuts}
					{@const bn = weekData.brassNuts}
					<div class="award-card trophy">
						<div class="award-band">
							<div class="award-emoji">🔩</div>
							<div class="award-label">Brass Nuts</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(bn.teamId)}<img class="award-img" src={teamLogoMap.get(bn.teamId)} alt={bn.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{bn.teamName}</div>
								<div class="award-meta">League Champion 🏆</div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.toiletBowl}
					{@const tb = weekData.toiletBowl}
					<div class="award-card trophy">
						<div class="award-band">
							<div class="award-emoji">🪠</div>
							<div class="award-label">Toilet Bowl</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(tb.teamId)}<img class="award-img" src={teamLogoMap.get(tb.teamId)} alt={tb.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{tb.teamName}</div>
								<div class="award-meta">Chumpionship Winner 🚽</div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.goldenApple}
					{@const g = weekData.goldenApple}
					<div class="award-card good">
						<div class="award-band">
							<div class="award-emoji">🍎</div>
							<div class="award-label">Golden Apple</div>
						</div>
						<div class="award-card-inner">
							<img class="award-img" src={playerImgUrl(g.playerId, g.position, g.nflTeam)} alt={g.playerName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />
							<div class="award-body">
								<div class="award-player">{g.playerName}</div>
								<div class="award-meta">{g.position}{g.nflTeam ? ' · ' + g.nflTeam : ''} · {g.teamName}</div>
								<div class="award-score green">{g.actualScore.toFixed(2)}</div>
								<div class="award-delta">proj {g.projectedScore.toFixed(1)} · <span class="green">{sign(g.delta)}{g.delta.toFixed(1)}</span></div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.brownBanana}
					{@const b = weekData.brownBanana}
					<div class="award-card bad">
						<div class="award-band">
							<div class="award-emoji">🍌</div>
							<div class="award-label">Brown Banana</div>
						</div>
						<div class="award-card-inner">
							<img class="award-img" src={playerImgUrl(b.playerId, b.position, b.nflTeam)} alt={b.playerName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />
							<div class="award-body">
								<div class="award-player">{b.playerName}</div>
								<div class="award-meta">{b.position}{b.nflTeam ? ' · ' + b.nflTeam : ''} · {b.teamName}</div>
								<div class="award-score red">{b.actualScore.toFixed(2)}</div>
								<div class="award-delta">proj {b.projectedScore.toFixed(1)} · <span class="red">{sign(b.delta)}{b.delta.toFixed(1)}</span></div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.lamentStud}
					{@const l = weekData.lamentStud}
					<div class="award-card bad">
						<div class="award-band">
							<div class="award-emoji">🤡</div>
							<div class="award-label">Lamest Stud</div>
						</div>
						<div class="award-card-inner">
							<img class="award-img" src={playerImgUrl(l.playerId, l.position, l.nflTeam)} alt={l.playerName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />
							<div class="award-body">
								<div class="award-player">{l.playerName}</div>
								<div class="award-meta">{l.position}{l.nflTeam ? ' · ' + l.nflTeam : ''} · {l.teamName}</div>
								<div class="award-score red">{l.actualScore.toFixed(2)}</div>
								<div class="award-delta">{ordinal(l.overallPick)} overall · Round {l.draftRound}</div>
							</div>
						</div>
					</div>
				{/if}
				{#if weekData.muscleMan}
					{@const m = weekData.muscleMan}
					<div class="award-card good">
						<div class="award-band">
							<div class="award-emoji">💪</div>
							<div class="award-label">Muscle Man</div>
						</div>
						<div class="award-card-inner">
							<img class="award-img" src={playerImgUrl(m.playerId, m.position, m.nflTeam)} alt={m.playerName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />
							<div class="award-body">
								<div class="award-player">{m.playerName}</div>
								<div class="award-meta">{m.position}{m.nflTeam ? ' · ' + m.nflTeam : ''} · {m.teamName}</div>
								<div class="award-score green">{m.actualScore.toFixed(2)}</div>
								<div class="award-delta">proj {m.projectedScore.toFixed(1)} · <span class="green">{sign(m.delta)}{m.delta.toFixed(1)}</span></div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.poopMan}
					{@const p = weekData.poopMan}
					<div class="award-card bad">
						<div class="award-band">
							<div class="award-emoji">💩</div>
							<div class="award-label">Poop Man</div>
						</div>
						<div class="award-card-inner">
							<img class="award-img" src={playerImgUrl(p.playerId, p.position, p.nflTeam)} alt={p.playerName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />
							<div class="award-body">
								<div class="award-player">{p.playerName}</div>
								<div class="award-meta">{p.position}{p.nflTeam ? ' · ' + p.nflTeam : ''} · {p.teamName}</div>
								<div class="award-score red">{p.actualScore.toFixed(2)}</div>
								<div class="award-delta">proj {p.projectedScore.toFixed(1)} · <span class="red">{sign(p.delta)}{p.delta.toFixed(1)}</span></div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.superMushroom}
					{@const a = weekData.superMushroom}
					<div class="award-card good">
						<div class="award-band">
							<div class="award-emoji">🍄</div>
							<div class="award-label">Super Mushroom</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(a.teamId)}<img class="award-img" src={teamLogoMap.get(a.teamId)} alt={a.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{a.teamName}</div>
								<div class="award-meta">Projected to lose vs {a.opponentName}</div>
								<div class="award-score green">{a.actualScore.toFixed(2)}</div>
								<div class="award-delta">proj {a.projectedScore.toFixed(1)} · opp proj {a.opponentProjected.toFixed(1)}</div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.closeShave}
					{@const cs = weekData.closeShave}
					<div class="award-card good">
						<div class="award-band">
							<div class="award-emoji">💈</div>
							<div class="award-label">Close Shave</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(cs.teamId)}<img class="award-img" src={teamLogoMap.get(cs.teamId)} alt={cs.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{cs.teamName}</div>
								<div class="award-meta">Narrowest win this week</div>
								<div class="award-score green">{(cs.loserScore + cs.margin).toFixed(2)}</div>
								<div class="award-delta">won by {cs.margin.toFixed(2)} pts · vs {cs.loserName} ({cs.loserScore.toFixed(2)})</div>
							</div>
						</div>
					</div>
				{/if}

				{#each weekData.assassins ?? [] as a}
					<div class="award-card good">
						<div class="award-band">
							<div class="award-emoji">🥷</div>
							<div class="award-label">Assassin</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(a.teamId)}<img class="award-img" src={teamLogoMap.get(a.teamId)} alt={a.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{a.teamName}</div>
								<div class="award-meta">Took out a top-3 scorer</div>
								<div class="award-score green">{a.actualScore.toFixed(2)}</div>
								<div class="award-delta">vs {a.victimName} · {a.victimScore.toFixed(2)}</div>
							</div>
						</div>
					</div>
				{/each}

				{#if weekData.gambler}
					{@const ga = weekData.gambler}
					<div class="award-card good">
						<div class="award-band">
							<div class="award-emoji">🎲</div>
							<div class="award-label">The Gambler</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(ga.teamId)}<img class="award-img" src={teamLogoMap.get(ga.teamId)} alt={ga.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{ga.teamName}</div>
								<div class="award-meta">Started lower-projected players who delivered</div>
								<div class="award-score green">{ga.successfulGambles}</div>
								<div class="award-delta">starters who beat a higher-proj bench player</div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.wrongMan}
					{@const wm = weekData.wrongMan}
					<div class="award-card bad">
						<div class="award-band">
							<div class="award-emoji">👥</div>
							<div class="award-label">Wrong Man</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(wm.teamId)}<img class="award-img" src={teamLogoMap.get(wm.teamId)} alt={wm.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{wm.teamName}</div>
								<div class="award-meta">Started {wm.startedName} ({wm.startedScore.toFixed(1)}) over {wm.benchedName} ({wm.benchedScore.toFixed(1)})</div>
								<div class="award-score red">−{wm.pointsLeft.toFixed(2)}</div>
								<div class="award-delta">pts left on bench</div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.luckyDevil}
					{@const ld = weekData.luckyDevil}
					<div class="award-card good">
						<div class="award-band">
							<div class="award-emoji">🍀</div>
							<div class="award-label">Lucky Devil</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(ld.teamId)}<img class="award-img" src={teamLogoMap.get(ld.teamId)} alt={ld.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{ld.teamName}</div>
								<div class="award-meta">Lowest-scoring winner this week</div>
								<div class="award-score">{ld.actualScore.toFixed(2)}</div>
								<div class="award-delta">would've beaten only {ld.wouldHaveBeaten} of {ld.totalTeams - 1} other teams</div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.mrMonopoly}
					{@const mm = weekData.mrMonopoly}
					<div class="award-card good">
						<div class="award-band">
							<div class="award-emoji">🎩</div>
							<div class="award-label">Mr. Monopoly</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(mm.teamId)}<img class="award-img" src={teamLogoMap.get(mm.teamId)} alt={mm.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{mm.teamName}</div>
								<div class="award-meta">Took over the season points lead</div>
								<div class="award-score green">{mm.currentTotal.toFixed(2)}</div>
								<div class="award-delta">overtook {mm.prevLeaderName} · {mm.prevLeaderTotal.toFixed(2)}</div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.hotRod}
					{@const hr = weekData.hotRod}
					<div class="award-card good">
						<div class="award-band">
							<div class="award-emoji">🏎️</div>
							<div class="award-label">Hot Rod</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(hr.teamId)}<img class="award-img" src={teamLogoMap.get(hr.teamId)} alt={hr.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{hr.teamName}</div>
								<div class="award-meta">Current win streak</div>
								<div class="award-score green">{hr.streak}W</div>
							</div>
						</div>
					</div>
				{/if}

				{#if weekData.snowMan}
					{@const sm = weekData.snowMan}
					<div class="award-card bad">
						<div class="award-band">
							<div class="award-emoji">⛄</div>
							<div class="award-label">Snow Man</div>
						</div>
						<div class="award-card-inner">
							{#if teamLogoMap.get(sm.teamId)}<img class="award-img" src={teamLogoMap.get(sm.teamId)} alt={sm.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
							<div class="award-body">
								<div class="award-player">{sm.teamName}</div>
								<div class="award-meta">Current losing streak</div>
								<div class="award-score red">{sm.streak}L</div>
							</div>
						</div>
					</div>
				{/if}




			</div>

			<details class="legend-card" bind:open={legendOpen}>
				<summary>Award Legend</summary>
				<div class="legend-grid">
					<span>🍎</span><span><strong>Golden Apple</strong> — biggest single-player over-performance vs projection</span>
					<span>🍌</span><span><strong>Brown Banana</strong> — biggest single-player under-performance vs projection</span>
					<span>🤡</span><span><strong>Lamest Stud</strong> — worst-scoring starter drafted in rounds 1–3</span>
					<span>🍄</span><span><strong>Super Mushroom</strong> — biggest overperformance among underdog winners (single award)</span>
					<span>💈</span><span><strong>Close Shave</strong> — narrowest margin of victory (under 5 pts)</span>
					<span>🥷</span><span><strong>Assassin</strong> — beat a top-3 scorer this week</span>
					<span>🎲</span><span><strong>The Gambler</strong> — most starters who outscored a higher-projected bench player at the same position (unique pairs)</span>
					<span>👥</span><span><strong>Wrong Man</strong> — biggest pts left on bench from one bad start decision</span>
					<span>🍀</span><span><strong>Lucky Devil</strong> — lowest-scoring winner who scored below the top half of the league</span>
					<span>🎩</span><span><strong>Mr. Monopoly</strong> — overtook the cumulative season points lead this week</span>
					<span>💪</span><span><strong>Muscle Man</strong> — top scorer in starting lineups this week</span>
					<span>💩</span><span><strong>Poop Man</strong> — bottom scorer in starting lineups this week (non-DST, non-K)</span>
					<span>🏎️</span><span><strong>Hot Rod</strong> — current highest win streak (solo leader, ≥ 3 wins)</span>
					<span>⛄</span><span><strong>Snow Man</strong> — current highest losing streak (solo leader, ≥ 3 losses)</span>
					<span>🔩</span><span><strong>Brass Nuts</strong> — League Champion (final playoff week)</span>
					<span>🪠</span><span><strong>Toilet Bowl</strong> — Chumpionship Winner (final playoff week)</span>
				</div>
			</details>
			{/if}

			{#if weekData.topStuds && weekData.topStuds.length > 0}
			<div class="studs-section">
				<h2 class="section-header" onclick={() => studsOpen = !studsOpen}>
					<span>Weekly Studs</span>
					<span class="section-chevron {studsOpen ? 'open' : ''}"></span>
				</h2>
				{#if studsOpen}
				{#each weekData.topStuds as s}
					{@const medal = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : null}
					{@const posClass = s.position === 'D/ST' ? 'DST' : s.position}
					<div class="stud-row">
						<div class="stud-rank {medal ? 'medal' : ''}">{medal ?? s.rank}</div>
						<img class="stud-img {s.position === 'D/ST' ? 'dst' : ''}" src={playerImgUrl(s.playerId, s.position, s.nflTeam)} alt={s.playerName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />
						<div class="stud-info">
							<div class="stud-name-line">
								<span class="stud-pos {posClass}">{s.position}</span>
								<span class="stud-name">{s.playerName}</span>
								{#if s.nflTeam}<span class="stud-nfl">{s.nflTeam}</span>{/if}
							</div>
						</div>
						<div class="stud-score">{s.score.toFixed(2)}</div>
						<div class="stud-owner">{s.ownerName}</div>
					</div>
				{/each}
			{/if}
			</div>
			{/if}

			<h2 class="section-header" onclick={() => matchupsOpen = !matchupsOpen}>
				<span>Matchups</span>
				<span class="section-chevron {matchupsOpen ? 'open' : ''}"></span>
			</h2>
			{#if matchupsOpen}

			{#if weekData.onVacation && weekData.onVacation.length > 0}
				<div class="vacation-section">
					<div class="vacation-header">🏖️ On Vacation</div>
					<div class="vacation-cards">
						{#each weekData.onVacation as vt}
							<div class="vacation-card">
								{#if weekData.playoffSeeds?.get(vt.teamId)}<span class="vacation-seed">#{weekData.playoffSeeds.get(vt.teamId)}</span>{/if}
								{#if teamLogoMap.get(vt.teamId)}<img src={teamLogoMap.get(vt.teamId)} alt={vt.teamName} style="width:20px;height:20px;border-radius:2px;object-fit:contain" onerror={(e) => (e.currentTarget as HTMLImageElement).style.display="none"} loading="lazy" />{/if}
								<span>{vt.teamName}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#each weekData.matchups as matchup}
				{@const isOptimal = showOptimal[matchup.matchupId] ?? false}
				{@const isBenchOpen = benchOpen[matchup.matchupId] ?? false}

{@const h2hKey = matchup.away ? `${Math.min(matchup.home.teamId, matchup.away.teamId)}-${Math.max(matchup.home.teamId, matchup.away.teamId)}` : null}
				<div id={h2hKey ? `matchup-${h2hKey}` : undefined} class="matchup-card {isOptimal ? 'optimal-mode' : ''}">
					{#if matchup.bracketLabel}
						<div class="bracket-label" style="padding: 8px 20px 0;">{matchup.bracketLabel}</div>
					{/if}
					<div class="matchup-header">
						<div class="score-line">
							<!-- Home -->
							<div class="team-score">
								{#if teamRanks.get(matchup.home.teamId)}<span class="team-rank">#{teamRanks.get(matchup.home.teamId)}</span>{/if}<span class="team-name {matchup.winner === 'home' ? 'winner' : 'loser'} {matchup.home.totalPoints === topScore ? 'top-scorer' : ''} {matchup.home.totalPoints === bottomScore ? 'bottom-scorer' : ''}">{matchup.home.teamName}{matchup.home.totalPoints === bottomScore ? ' 💩' : ''}</span><span class="team-record"> ({teamRecords[matchup.home.teamId]?.wins ?? 0}-{teamRecords[matchup.home.teamId]?.losses ?? 0})</span>
								{#each (teamAwardMap.get(matchup.home.teamId) ?? []) as emoji}<span class="team-award-badge">{emoji}</span>{/each}
								<span class="score {matchup.winner === 'home' ? 'winner' : 'loser'} {matchup.home.totalPoints === bottomScore ? 'bottom-scorer' : ''}">{matchup.home.totalPoints.toFixed(2)}</span>
							</div>
							<span class="vs">vs</span>
							<!-- Away -->
							{#if matchup.away}
								<div class="team-score">
									<span class="score {matchup.winner === 'away' ? 'winner' : 'loser'} {matchup.away.totalPoints === bottomScore ? 'bottom-scorer' : ''}">{matchup.away.totalPoints.toFixed(2)}</span>
									<span class="team-name {matchup.winner === 'away' ? 'winner' : 'loser'} {matchup.away.totalPoints === topScore ? 'top-scorer' : ''} {matchup.away.totalPoints === bottomScore ? 'bottom-scorer' : ''}">{matchup.away.teamName}{matchup.away.totalPoints === bottomScore ? ' 💩' : ''}</span><span class="team-record"> ({teamRecords[matchup.away.teamId]?.wins ?? 0}-{teamRecords[matchup.away.teamId]?.losses ?? 0})</span>{#if teamRanks.get(matchup.away.teamId)}<span class="team-rank">#{teamRanks.get(matchup.away.teamId)}</span>{/if}
								{#each (teamAwardMap.get(matchup.away.teamId) ?? []) as emoji}<span class="team-award-badge">{emoji}</span>{/each}
								</div>
							{/if}
						</div>


						<button
							class="cake-btn {isOptimal ? 'active' : ''}"
							onclick={() => toggleOptimal(matchup.matchupId)}
							title="Optimal Lineup"
							aria-label="Optimal Lineup"
						>🍰</button>
					</div>

					<!-- Results / Optimal view -->
					{#if !isOptimal}
						<div class="roster-grid">
							{#each [matchup.home, matchup.away].filter(Boolean) as team}
								{@const t = team as ProcessedTeam}
								<div class="team-col">
									<div class="col-header">
										<span class="col-team-name">{t.teamName}</span>
										{#each (teamAwardMap.get(t.teamId) ?? []) as emoji}<span class="team-award-badge sm">{emoji}</span>{/each}
									</div>

									{#each sortPlayers(t.starters) as p}
										<div class="player-row">
											<div class="player-left">
												<span class="slot-label">{p.slotName}</span>
												<span class="player-name">{p.fullName}</span>
												{#if p.nflTeam}<span class="nfl-team">{p.nflTeam}</span>{/if}
												{#if weekData?.muscleMan && p.actualScore === weekData.muscleMan.actualScore}<span class="award-emoji-inline" title="Muscle Man — top scorer this week">💪</span>{/if}
												{#if weekData?.poopMan && p.position !== 'D/ST' && p.position !== 'K' && p.actualScore === weekData.poopMan.actualScore}<span class="award-emoji-inline" title="Poop Man — bottom scorer this week">💩</span>{/if}
												{#if p.playerId === weekData?.goldenApple?.playerId}<span class="award-emoji-inline" title="Golden Apple — biggest over-performance">🍎</span>{/if}
												{#if p.playerId === weekData?.brownBanana?.playerId}<span class="award-emoji-inline" title="Brown Banana — biggest under-performance">🍌</span>{/if}
												{#if p.playerId === weekData?.lamentStud?.playerId}<span class="award-emoji-inline" title="Lamest Stud — worst early-round pick">🤡</span>{/if}
												{#if p.injuryStatus === 'OUT' || p.injuryStatus === 'DOUBTFUL'}
													<span class="injury-badge out">{p.injuryStatus[0]}</span>
												{:else if p.injuryStatus === 'QUESTIONABLE'}
													<span class="injury-badge q">Q</span>
												{/if}
											</div>
											<div class="player-right">
												<span class="proj">{p.projectedScore.toFixed(1)}</span>
												<span class="actual {p.actualScore > p.projectedScore ? 'over' : p.actualScore < p.projectedScore * 0.7 ? 'under' : 'norm'}">{p.actualScore.toFixed(2)}</span>
											</div>
										</div>
									{/each}
									<div class="total-row">
										<span class="total-label">TOTAL</span>
										<div class="total-right">
											<span class="proj">{t.starters.reduce((s, p) => s + p.projectedScore, 0).toFixed(2)}</span>
											<span class="actual norm">{t.totalPoints.toFixed(2)}</span>
										</div>
									</div>

									<!-- Bench toggle (shared across both teams via matchupId) -->
									{#if t.bench.filter(p => p.slotName !== 'IR').length > 0}
										<button class="bench-toggle" onclick={() => toggleBench(matchup.matchupId)}>
											<span>{isBenchOpen ? '▴' : '▾'}</span> Bench
										</button>
										{#if isBenchOpen}
											<div class="bench-section">
												{#each t.bench.filter(p => p.slotName !== 'IR') as p}
													<div class="bench-row">
														<div class="bench-left">
															<span class="slot-label">{p.position}</span>
															<span>{p.fullName}</span>
															{#if p.nflTeam}<span class="nfl-team">{p.nflTeam}</span>{/if}
														</div>
														<div class="player-right">
															<span class="proj">{p.projectedScore.toFixed(1)}</span>
															<span class="actual norm">{p.actualScore.toFixed(2)}</span>
														</div>
													</div>
												{/each}
											</div>
										{/if}
									{/if}

									<div class="whb">
										Would've beaten <strong>{t.wouldHaveBeaten}/{t.totalTeams - 1}</strong> teams this week
										{#if t.isLuckiest}<span class="lucky-tag"> · 🍀 luckiest win</span>{/if}
									</div>
								</div>
							{/each}
						</div>

					<!-- Optimal view -->
					{:else}
						<div class="roster-grid">
							{#each [matchup.home, matchup.away].filter(Boolean) as team}
								{@const t = team as ProcessedTeam}
								<div class="team-col">
									<div class="col-header">
										<span class="col-team-name">{t.teamName}</span>
										{#each (teamAwardMap.get(t.teamId) ?? []) as emoji}<span class="team-award-badge sm">{emoji}</span>{/each}
										<span class="cake-opt-delta">+{(t.optimalPoints - t.totalPoints).toFixed(1)}</span>
									</div>

									{#each sortOptimalPlayers(t.optimalStarters) as p}
										{@const wasStarted = t.starters.some(s => s.playerId === p.playerId)}
										<div class="player-row {!wasStarted ? 'was-benched' : ''}">
											<div class="player-left">
												<span class="slot-label">{p.slotName}</span>
												<span class="player-name">{p.fullName}</span>
												{#if p.nflTeam}<span class="nfl-team">{p.nflTeam}</span>{/if}
												{#if weekData?.muscleMan && p.actualScore === weekData.muscleMan.actualScore}<span class="award-emoji-inline" title="Muscle Man — top scorer this week">💪</span>{/if}
												{#if weekData?.poopMan && p.position !== 'D/ST' && p.position !== 'K' && p.actualScore === weekData.poopMan.actualScore}<span class="award-emoji-inline" title="Poop Man — bottom scorer this week">💩</span>{/if}
												{#if p.playerId === weekData?.goldenApple?.playerId}<span class="award-emoji-inline" title="Golden Apple — biggest over-performance">🍎</span>{/if}
												{#if p.playerId === weekData?.brownBanana?.playerId}<span class="award-emoji-inline" title="Brown Banana — biggest under-performance">🍌</span>{/if}
												{#if p.playerId === weekData?.lamentStud?.playerId}<span class="award-emoji-inline" title="Lamest Stud — worst early-round pick">🤡</span>{/if}
												{#if !wasStarted}<span class="benched-tag">BENCHED</span>{/if}
											</div>
											<div class="player-right">
												<span class="proj">{p.projectedScore.toFixed(1)}</span>
												<span class="actual over">{p.actualScore.toFixed(2)}</span>
											</div>
										</div>
									{/each}
									<div class="total-row">
										<span class="total-label">TOTAL</span>
										<div class="total-right">
											<span class="proj">{t.optimalStarters.reduce((s,p) => s+p.projectedScore, 0).toFixed(2)}</span>
											<span class="actual norm" style="color:var(--green)">{t.optimalPoints.toFixed(2)}</span>
										</div>
									</div>

									<!-- Optimal bench: starters displaced by the optimal lineup -->
									{#if displacedFromOptimal(t).length > 0}
										<button class="bench-toggle" onclick={() => toggleBench(matchup.matchupId)}>
											<span>{isBenchOpen ? '▴' : '▾'}</span> Bench
										</button>
										{#if isBenchOpen}
											<div class="bench-section">
												{#each displacedFromOptimal(t) as p}
													<div class="bench-row displaced">
														<div class="bench-left">
															<span class="slot-label">{p.position}</span>
															<span>{p.fullName}</span>
															{#if p.nflTeam}<span class="nfl-team">{p.nflTeam}</span>{/if}
														</div>
														<div class="player-right">
															<span class="proj">{p.projectedScore.toFixed(1)}</span>
															<span class="actual norm">{p.actualScore.toFixed(2)}</span>
														</div>
													</div>
												{/each}
											</div>
										{/if}
									{/if}

									{#if optimalWouldWin(t, matchup) !== teamActuallyWon(t, matchup)}
										<div class="opt-outcome {optimalWouldWin(t, matchup) ? 'would-win' : 'would-lose'}">
											{optimalWouldWin(t, matchup) ? '✓ Would have won' : '✗ Would have lost anyway'}
										</div>
									{/if}
									<div class="whb">
										Optimal would've beaten <strong style="color:var(--gold)">{t.optimalWouldHaveBeaten}/{t.totalTeams - 1}</strong> teams
									</div>
								</div>
							{/each}
						</div>
					{/if}

				{#if matchup.away && matchupH2H[matchup.matchupId]}
					{@const h2h = matchupH2H[matchup.matchupId]}
					{@const total = h2h.homeWins + h2h.awayWins + h2h.ties}
					{#if total > 0}
						<div class="h2h-section">
							<button class="h2h-toggle" onclick={() => toggleH2H(matchup.matchupId)}>
								<span>🏛️ Historic record:</span>
								<span class="h2h-summary">{matchup.home.teamName} {h2h.homeWins}–{h2h.awayWins}{h2h.ties ? `–${h2h.ties}` : ''} {matchup.away.teamName}</span>
								<span class="h2h-chevron" style="transform: rotate({h2hOpen[matchup.matchupId] ? 0 : -90}deg)">›</span>
							</button>
							{#if h2hOpen[matchup.matchupId]}
								{#if !h2hHistory[matchup.matchupId]}
									<div class="h2h-loading">Loading…</div>
								{:else}
									<div class="h2h-list">
										{#each h2hHistory[matchup.matchupId] as game}
											{@const homeWon = game.winner === 'home'}
											{@const lo = Math.min(game.homeTeamId, game.awayTeamId)}
											{@const hi = Math.max(game.homeTeamId, game.awayTeamId)}
											<a class="h2h-row" href="/?season={game.seasonId}&week={game.week}#matchup-{lo}-{hi}">
												<span class="h2h-meta">{game.seasonId} · Wk {game.week}</span>
												<span class="h2h-teams">
													<span class="{homeWon ? 'h2h-winner' : 'h2h-loser'}">{game.homeTeamName}</span>
													<span class="h2h-score">{game.homeScore.toFixed(1)} – {game.awayScore.toFixed(1)}</span>
													<span class="{homeWon ? 'h2h-loser' : 'h2h-winner'}">{game.awayTeamName}</span>
												</span>
											</a>
										{/each}
									</div>
								{/if}
							{/if}
						</div>
					{/if}
				{/if}
				</div>
			{/each}




			<!-- ── Season Standings ──────────────────────────────────────────────────── -->
			{#if standingsHistory.length > 0 && chartInfo}
				<h2 class="section-header" onclick={() => standingsOpen = !standingsOpen}>
					<span>Season Standings</span>
					<span class="section-chevron {standingsOpen ? 'open' : ''}"></span>
				</h2>
				{#if standingsOpen}
					{@const c = chartInfo}
					<div class="standings-chart-wrap">
						<svg viewBox="0 0 {SVG_W} {SVG_H}" class="standings-svg">
							<!-- Playoff background shading -->
							{#if c.playoffStartWeek !== null}
								<rect
									class="chart-playoff-bg"
									x={c.xFor(c.playoffStartWeek - 0.5)}
									y={PAD_T}
									width={SVG_W - PAD_R - c.xFor(c.playoffStartWeek - 0.5)}
									height={PLOT_H}
								/>
							{/if}

							<!-- Horizontal grid lines (one per rank) -->
							{#each c.gridRanks as rank}
								<line
									class="chart-grid-line"
									x1={PAD_L} y1={c.yFor(rank)}
									x2={SVG_W - PAD_R} y2={c.yFor(rank)}
								/>
								<text class="chart-axis-label" x={PAD_L - 6} y={c.yFor(rank) + 3.5} text-anchor="end">{rank}</text>
							{/each}

							<!-- Vertical week lines + labels -->
							{#each c.allWeeks as week}
								{@const isPlayoffWeek = c.playoffStartWeek !== null && week >= c.playoffStartWeek}
								<line
									class="{isPlayoffWeek ? 'chart-grid-line-playoff' : 'chart-grid-line'}"
									x1={c.xFor(week)} y1={PAD_T}
									x2={c.xFor(week)} y2={PAD_T + PLOT_H}
								/>
								{#if week > 0}
									<text class="chart-week-label" x={c.xFor(week)} y={PAD_T + PLOT_H + 14}>
										{week}
									</text>
								{/if}
							{/each}

							<!-- "PLAYOFFS" label -->
							{#if c.playoffStartWeek !== null}
								{@const pLabelX = (c.xFor(c.playoffStartWeek) + (SVG_W - PAD_R)) / 2}
								<text class="chart-playoff-label" x={pLabelX} y={PAD_T - 3}>PLAYOFFS</text>
							{/if}

							<!-- Week 0 vertical line -->
							<line class="chart-grid-line" x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + PLOT_H} />

							<!-- Team lines -->
							{#each c.teams as team}
								{#if team.d}
									<path
										class="chart-team-line"
										d={team.d}
										stroke={team.color}
									>
										<title>{team.teamName}</title>
									</path>
								{/if}
							{/each}

							<!-- Clinch / Elimination markers -->
							{#each c.teams as team}
								{#if team.clinchX != null && team.clinchY != null}
									<text class="chart-marker" x={team.clinchX} y={team.clinchY} text-anchor="middle" dominant-baseline="middle">🔒</text>
								{/if}
								{#if team.elimX != null && team.elimY != null}
									<text class="chart-marker" x={team.elimX} y={team.elimY} text-anchor="middle" dominant-baseline="middle">💀</text>
								{/if}
							{/each}

							<!-- X-axis label -->
							<text class="chart-axis-label" x={PAD_L + PLOT_W / 2} y={SVG_H} text-anchor="middle">Week</text>
						</svg>

						<!-- Legend -->
						<div class="chart-legend">
							{#each c.teams as team}
								<div class="chart-legend-item">
									<span class="chart-legend-dot" style="background:{team.color}"></span>
									<span>{team.teamName}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}
			{/if}
		{:else if data.isPreviewWeek && data.previewMatchups?.length}
			<div class="week-label preview-label">
				{data.previewWeekId?.seasonId} · ⏳ Week {data.previewWeekId?.scoringPeriodId} Preview
			</div>

			<h2 class="section-header" onclick={() => matchupsOpen = !matchupsOpen}>
				<span>Matchups</span>
				<span class="section-chevron {matchupsOpen ? 'open' : ''}"></span>
			</h2>
			{#if matchupsOpen}
			{#each data.previewMatchups as pmatchup}
				{@const isOptimal = showOptimal[pmatchup.matchupId] ?? false}
				{@const isBenchOpen = benchOpen[pmatchup.matchupId] ?? false}
				<div class="matchup-card preview-card {isOptimal ? 'optimal-mode' : ''}">
					<div class="matchup-header">
						<div class="score-line">
							<!-- Home -->
							<div class="team-score">
								<span class="team-name">{pmatchup.home.teamName}</span>
								<span class="team-record"> ({data.teamRecords[pmatchup.home.teamId]?.wins ?? 0}-{data.teamRecords[pmatchup.home.teamId]?.losses ?? 0})</span>
								<span class="score preview-proj">{pmatchup.home.projectedPoints.toFixed(2)}</span>
							</div>
							<span class="vs">vs</span>
							<!-- Away -->
							{#if pmatchup.away}
								<div class="team-score">
									<span class="score preview-proj">{pmatchup.away.projectedPoints.toFixed(2)}</span>
									<span class="team-name">{pmatchup.away.teamName}</span>
									<span class="team-record"> ({data.teamRecords[pmatchup.away.teamId]?.wins ?? 0}-{data.teamRecords[pmatchup.away.teamId]?.losses ?? 0})</span>
								</div>
							{/if}
						</div>

						<!-- Win probability bar -->
						{#if pmatchup.away}
							<div class="win-prob-row">
								<span class="win-prob-pct home-pct">{(pmatchup.home.winProbability * 100).toFixed(0)}%</span>
								<div class="win-prob-bar">
									<div class="prob-home" style="width:{(pmatchup.home.winProbability * 100).toFixed(1)}%"></div>
								</div>
								<span class="win-prob-pct away-pct">{(pmatchup.away.winProbability * 100).toFixed(0)}%</span>
							</div>
						{/if}

						<button
							class="cake-btn {isOptimal ? 'active' : ''}"
							onclick={() => toggleOptimal(pmatchup.matchupId)}
							title="Optimal Lineup (by projection)"
						>🍰</button>
					</div>

					<!-- Rosters -->
					{#if !isOptimal}
						<div class="roster-grid">
							{#each [pmatchup.home, pmatchup.away].filter(Boolean) as pteam}
								<div class="team-col">
									<div class="col-header"><span class="col-team-name">{pteam.teamName}</span></div>
									{#each pteam.starters as p}
										<div class="player-row">
											<div class="player-left">
												<span class="slot-label">{p.slotName}</span>
												<span class="player-name">{p.fullName}</span>
												{#if p.nflTeam}<span class="nfl-team">{p.nflTeam}</span>{/if}
												{#if p.injuryStatus === 'OUT' || p.injuryStatus === 'DOUBTFUL'}
													<span class="injury-badge out">{p.injuryStatus[0]}</span>
												{:else if p.injuryStatus === 'QUESTIONABLE'}
													<span class="injury-badge q">Q</span>
												{/if}
											</div>
											<div class="player-right">
												<span class="proj">{p.projectedScore.toFixed(1)}</span>
											</div>
										</div>
									{/each}
									<div class="total-row">
										<span class="total-label">PROJ</span>
										<div class="total-right">
											<span class="actual norm">{pteam.projectedPoints.toFixed(2)}</span>
										</div>
									</div>
									{#if pteam.bench.filter(p => p.slotName !== 'IR').length > 0}
										<button class="bench-toggle" onclick={() => toggleBench(pmatchup.matchupId)}>
											<span>{isBenchOpen ? '▴' : '▾'}</span> Bench
										</button>
										{#if isBenchOpen}
											<div class="bench-section">
												{#each pteam.bench.filter(p => p.slotName !== 'IR') as p}
													<div class="bench-row">
														<div class="bench-left">
															<span class="slot-label">{p.position}</span>
															<span>{p.fullName}</span>
															{#if p.nflTeam}<span class="nfl-team">{p.nflTeam}</span>{/if}
														</div>
														<div class="player-right">
															<span class="proj">{p.projectedScore.toFixed(1)}</span>
														</div>
													</div>
												{/each}
											</div>
										{/if}
									{/if}
								</div>
							{/each}
						</div>

					<!-- Optimal (cake) view — sorted by projected score -->
					{:else}
						<div class="roster-grid">
							{#each [pmatchup.home, pmatchup.away].filter(Boolean) as pteam}
								<div class="team-col">
									<div class="col-header">
										<span class="col-team-name">{pteam.teamName}</span>
										<span class="cake-opt-delta">+{(pteam.projectedOptimalPoints - pteam.projectedPoints).toFixed(1)}</span>
									</div>
									{#each pteam.optimalStarters as p}
										{@const wasStarted = pteam.starters.some(s => s.playerId === p.playerId)}
										<div class="player-row {!wasStarted ? 'was-benched' : ''}">
											<div class="player-left">
												<span class="slot-label">{p.slotName}</span>
												<span class="player-name">{p.fullName}</span>
												{#if p.nflTeam}<span class="nfl-team">{p.nflTeam}</span>{/if}
												{#if !wasStarted}<span class="benched-tag">BENCHED</span>{/if}
											</div>
											<div class="player-right">
												<span class="proj">{p.projectedScore.toFixed(1)}</span>
											</div>
										</div>
									{/each}
									<div class="total-row">
										<span class="total-label">OPT PROJ</span>
										<div class="total-right">
											<span class="actual norm" style="color:var(--green)">{pteam.projectedOptimalPoints.toFixed(2)}</span>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<!-- H2H section -->
					{#if pmatchup.h2h && pmatchup.away}
						{@const h2h = pmatchup.h2h}
						{@const total = h2h.homeWins + h2h.awayWins + h2h.ties}
						{#if total > 0}
							<div class="h2h-section">
								<button class="h2h-toggle" onclick={() => toggleH2H(pmatchup.matchupId)}>
									<span>🏛️ Historic record:</span>
									<span class="h2h-summary">{pmatchup.home.teamName} {h2h.homeWins}–{h2h.awayWins}{h2h.ties ? `–${h2h.ties}` : ''} {pmatchup.away.teamName}</span>
									<span class="h2h-chevron" style="transform: rotate({h2hOpen[pmatchup.matchupId] ? 0 : -90}deg)">›</span>
								</button>
							</div>
						{/if}
					{/if}
				</div>
			{/each}
			{/if}

			<!-- Standings chart (shows last completed week's standings) -->
			{#if standingsHistory.length > 0 && chartInfo}
				<h2 class="section-header" onclick={() => standingsOpen = !standingsOpen}>
					<span>Season Standings</span>
					<span class="section-chevron {standingsOpen ? 'open' : ''}"></span>
				</h2>
				{#if standingsOpen}
					{@const c = chartInfo}
					<div class="standings-chart-wrap">
						<svg viewBox="0 0 {SVG_W} {SVG_H}" class="standings-svg">
							{#if c.playoffStartWeek !== null}
								<rect class="chart-playoff-bg" x={c.xFor(c.playoffStartWeek - 0.5)} y={PAD_T} width={SVG_W - PAD_R - c.xFor(c.playoffStartWeek - 0.5)} height={PLOT_H} />
							{/if}
							{#each c.gridRanks as rank}
								<line class="chart-grid-line" x1={PAD_L} y1={c.yFor(rank)} x2={SVG_W - PAD_R} y2={c.yFor(rank)} />
								<text class="chart-axis-label" x={PAD_L - 6} y={c.yFor(rank) + 3.5} text-anchor="end">{rank}</text>
							{/each}
							{#each c.allWeeks as week}
								{@const isPlayoffWeek = c.playoffStartWeek !== null && week >= c.playoffStartWeek}
								<line class="{isPlayoffWeek ? 'chart-grid-line-playoff' : 'chart-grid-line'}" x1={c.xFor(week)} y1={PAD_T} x2={c.xFor(week)} y2={PAD_T + PLOT_H} />
								{#if week > 0}<text class="chart-week-label" x={c.xFor(week)} y={PAD_T + PLOT_H + 14}>{week}</text>{/if}
							{/each}
							{#if c.playoffStartWeek !== null}
								{@const pLabelX = (c.xFor(c.playoffStartWeek) + (SVG_W - PAD_R)) / 2}
								<text class="chart-playoff-label" x={pLabelX} y={PAD_T - 3}>PLAYOFFS</text>
							{/if}
							<line class="chart-grid-line" x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + PLOT_H} />
							{#each c.teams as team}
								{#if team.d}<path class="chart-team-line" d={team.d} stroke={team.color}><title>{team.teamName}</title></path>{/if}
							{/each}
							{#each c.teams as team}
								{#if team.clinchX != null && team.clinchY != null}<text class="chart-marker" x={team.clinchX} y={team.clinchY} text-anchor="middle" dominant-baseline="middle">🔒</text>{/if}
								{#if team.elimX != null && team.elimY != null}<text class="chart-marker" x={team.elimX} y={team.elimY} text-anchor="middle" dominant-baseline="middle">💀</text>{/if}
							{/each}
							<text class="chart-axis-label" x={PAD_L + PLOT_W / 2} y={SVG_H} text-anchor="middle">Week</text>
						</svg>
						<div class="chart-legend">
							{#each c.teams as team}
								<div class="chart-legend-item">
									<span class="chart-legend-dot" style="background:{team.color}"></span>
									<span>{team.teamName}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}

		{:else}
			<div class="empty">No data found. Run the backfill to populate historical data.</div>
		{/if}


	</main>
</div>
