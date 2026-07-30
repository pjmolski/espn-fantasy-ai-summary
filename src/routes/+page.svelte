<script lang="ts">
	import type { ProcessedWeek, ProcessedMatchup, ProcessedTeam, ProcessedPlayer } from '$lib/weekProcessor';

	export let data: {
		availableWeeks: Array<{ seasonId: number; scoringPeriodId: number; isPlayoff: boolean }>;
		weekData: ProcessedWeek | null;
		error?: string;
	};

	let weekData: ProcessedWeek | null = data.weekData;
	let loading = false;

	let selectedSeason: number = data.weekData?.seasonId ?? data.availableWeeks[0]?.seasonId;
	let selectedWeek: number = data.weekData?.scoringPeriodId ?? data.availableWeeks[0]?.scoringPeriodId;

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

	async function loadWeek(seasonId: number, week: number) {
		loading = true;
		showOptimal = {};
		benchOpen = {};
		try {
			const res = await fetch(`/api/week-data?season=${seasonId}&week=${week}`);
			weekData = await res.json();
		} catch (e) {
			console.error(e);
		} finally {
			loading = false;
		}
	}

	function onSeasonChange() {
		const weeks = weeksBySeason.get(selectedSeason) ?? [];
		if (weeks.length > 0) {
			selectedWeek = weeks[0].scoringPeriodId;
			loadWeek(selectedSeason, selectedWeek);
		}
	}

	function onWeekChange() {
		loadWeek(selectedSeason, selectedWeek);
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
		return map;
	})();

	let legendOpen = false;

	function displacedFromOptimal(t: ProcessedTeam): ProcessedPlayer[] {
		const optIds = new Set(t.optimalStarters.map(s => s.playerId));
		return [...t.starters, ...t.bench].filter(p => !optIds.has(p.playerId) && p.slotName !== 'IR');
	}

	function sortPlayers(players: ProcessedPlayer[]) {
		return [...players].sort((a, b) => SLOT_ORDER.indexOf(a.slotName) - SLOT_ORDER.indexOf(b.slotName));
	}
</script>

<svelte:head>
	<title>Fantasy Football</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@100;200;300;400;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<style>
	:global(*) { box-sizing: border-box; margin: 0; padding: 0; }
	:global(:root) { --gold: #ffcc33; }
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
	select:focus { border-color: #00d26d; }

	/* Main */
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 32px 40px 80px;
	}

	.week-label {
		font-size: 11px;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: rgba(255,255,255,0.4);
		margin-bottom: 24px;
	}

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
	.score.winner { color: #00d26d; }
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
		border-color: #00ccff;
		background: rgba(0,204,255,0.12);
		box-shadow: 0 0 0 3px rgba(0,204,255,0.15);
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
		font-size: 9px;
		font-weight: 700;
		padding: 1px 4px;
		border-radius: 2px;
		flex-shrink: 0;
	}
	.injury-badge.out  { background: rgba(255,90,70,0.2);  color: #ff5a46; }
	.injury-badge.q    { background: rgba(255,200,50,0.2); color: var(--gold); }

	.player-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: 6px; }
	.proj { font-size: 11px; color: rgba(255,255,255,0.25); }
	.actual {
		font-size: 13px;
		font-weight: 600;
		width: 48px;
		text-align: right;
	}
	.actual.over  { color: #00d26d; }
	.actual.under { color: #ff5a46; }
	.actual.norm  { color: rgba(255,255,255,0.8); }

	/* Would-have-beaten */
	.whb {
		margin-top: 10px;
		font-size: 11px;
		color: rgba(255,255,255,0.3);
		letter-spacing: 0.3px;
	}
	.whb strong { color: rgba(255,255,255,0.7); }
	.lucky-tag { color: #00d26d; }

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

	.matchup-card.optimal-mode { background: rgba(0,204,255,0.05); border-color: rgba(0,204,255,0.3); }
	.matchup-card.optimal-mode .matchup-header { background: rgba(0,60,80,0.7); border-bottom-color: rgba(0,204,255,0.2); }

	/* Optimal highlight */
	.was-benched { background: rgba(255,200,50,0.07) !important; }
	.was-benched .player-name { color: var(--gold); }
	.benched-tag { font-size: 9px; color: rgba(255,200,50,0.6); font-weight: 700; letter-spacing: 0.5px; }

	/* Optimal outcome line */
	.opt-outcome {
		margin-top: 8px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.3px;
	}
	.opt-outcome.would-win { color: #00d26d; }
	.opt-outcome.would-lose { color: #ff5a46; }

	/* Awards */
	.awards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 40px; }
	@media (max-width: 640px) { .awards { grid-template-columns: 1fr; } }
	.award-card {
		background: #272727;
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 3px;
		padding: 18px;
	}
	.award-card.good { border-left: 3px solid #00d26d; }
	.award-card.bad  { border-left: 3px solid #ff5a46; }

	.award-emoji { font-size: 24px; float: left; margin-right: 18px; }
	.award-label {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 2px;
		text-transform: uppercase;
		color: rgba(255,255,255,0.3);
		margin-bottom: 0;
	}
	.award-player { font-size: 15px; font-weight: 600; }
	.award-meta { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 0; }
	.award-score { font-size: 22px; font-weight: 100; letter-spacing: -0.5px; margin-top: 8px; }
	.award-score.green { color: #00d26d; }
	.award-score.red   { color: #ff5a46; }
	.award-delta { font-size: 11px; margin-top: 2px; color: rgba(255,255,255,0.35); }
	.award-delta .green { color: #00d26d; }
	.award-delta .red   { color: #ff5a46; }

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

	/* Award legend */
	.legend-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 6px;
		padding: 10px 16px;
		margin-bottom: 24px;
		max-width: 800px;
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
</style>

<div class="page">
	<div class="top-bar">
		<div class="selects">
			<select bind:value={selectedSeason} on:change={onSeasonChange}>
				{#each seasons as s}
					<option value={s}>{s} Season</option>
				{/each}
			</select>
			<select bind:value={selectedWeek} on:change={onWeekChange}>
				{#each weeksForSeason as w}
					<option value={w.scoringPeriodId}>{w.isPlayoff ? '🏆 ' : ''}Week {w.scoringPeriodId}</option>
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

			<!-- Awards -->
			<div class="awards">
				{#if weekData.goldenApple}
					{@const g = weekData.goldenApple}
					<div class="award-card good">
						<div class="award-emoji">🍎</div>
						<div class="award-label">Golden Apple</div>
						<div class="award-player">{g.playerName}</div>
						<div class="award-meta">{g.position}{g.nflTeam ? ' · ' + g.nflTeam : ''} · {g.teamName}</div>
						<div class="award-score green">{g.actualScore.toFixed(2)}</div>
						<div class="award-delta">proj {g.projectedScore.toFixed(1)} · <span class="green">{sign(g.delta)}{g.delta.toFixed(1)}</span></div>
					</div>
				{/if}

				{#if weekData.brownBanana}
					{@const b = weekData.brownBanana}
					<div class="award-card bad">
						<div class="award-emoji">🍌</div>
						<div class="award-label">Brown Banana</div>
						<div class="award-player">{b.playerName}</div>
						<div class="award-meta">{b.position}{b.nflTeam ? ' · ' + b.nflTeam : ''} · {b.teamName}</div>
						<div class="award-score red">{b.actualScore.toFixed(2)}</div>
						<div class="award-delta">proj {b.projectedScore.toFixed(1)} · <span class="red">{sign(b.delta)}{b.delta.toFixed(1)}</span></div>
					</div>
				{/if}

				{#if weekData.lamentStud}
					{@const l = weekData.lamentStud}
					<div class="award-card bad">
						<div class="award-emoji">🤡</div>
						<div class="award-label">Lamest Stud</div>
						<div class="award-player">{l.playerName}</div>
						<div class="award-meta">{l.position}{l.nflTeam ? ' · ' + l.nflTeam : ''} · {l.teamName}</div>
						<div class="award-score red">{l.actualScore.toFixed(2)}</div>
						<div class="award-delta">{ordinal(l.overallPick)} overall · Round {l.draftRound}</div>
					</div>
				{/if}
				{#if weekData.muscleMan}
					{@const m = weekData.muscleMan}
					<div class="award-card good">
						<div class="award-emoji">💪</div>
						<div class="award-label">Muscle Man</div>
						<div class="award-player">{m.playerName}</div>
						<div class="award-meta">{m.position}{m.nflTeam ? ' · ' + m.nflTeam : ''} · {m.teamName}</div>
						<div class="award-score green">{m.actualScore.toFixed(2)}</div>
						<div class="award-delta">proj {m.projectedScore.toFixed(1)} · <span class="green">{sign(m.delta)}{m.delta.toFixed(1)}</span></div>
					</div>
				{/if}

				{#if weekData.poopMan}
					{@const p = weekData.poopMan}
					<div class="award-card bad">
						<div class="award-emoji">💩</div>
						<div class="award-label">Poop Man</div>
						<div class="award-player">{p.playerName}</div>
						<div class="award-meta">{p.position}{p.nflTeam ? ' · ' + p.nflTeam : ''} · {p.teamName}</div>
						<div class="award-score red">{p.actualScore.toFixed(2)}</div>
						<div class="award-delta">proj {p.projectedScore.toFixed(1)} · <span class="red">{sign(p.delta)}{p.delta.toFixed(1)}</span></div>
					</div>
				{/if}

				{#if weekData.superMushroom}
					{@const a = weekData.superMushroom}
					<div class="award-card good">
						<div class="award-emoji">🍄</div>
						<div class="award-label">Super Mushroom</div>
						<div class="award-player">{a.teamName}</div>
						<div class="award-meta">Projected to lose vs {a.opponentName}</div>
						<div class="award-score green">{a.actualScore.toFixed(2)}</div>
						<div class="award-delta">proj {a.projectedScore.toFixed(1)} · opp proj {a.opponentProjected.toFixed(1)}</div>
					</div>
				{/if}

				{#if weekData.closeShave}
					{@const cs = weekData.closeShave}
					<div class="award-card good">
						<div class="award-emoji">💈</div>
						<div class="award-label">Close Shave</div>
						<div class="award-player">{cs.teamName}</div>
						<div class="award-meta">Narrowest win this week</div>
						<div class="award-score green">{(cs.loserScore + cs.margin).toFixed(2)}</div>
						<div class="award-delta">won by {cs.margin.toFixed(2)} pts · vs {cs.loserName} ({cs.loserScore.toFixed(2)})</div>
					</div>
				{/if}

				{#each weekData.assassins ?? [] as a}
					<div class="award-card good">
						<div class="award-emoji">🥷</div>
						<div class="award-label">Assassin</div>
						<div class="award-player">{a.teamName}</div>
						<div class="award-meta">Took out a top-3 scorer</div>
						<div class="award-score green">{a.actualScore.toFixed(2)}</div>
						<div class="award-delta">vs {a.victimName} · {a.victimScore.toFixed(2)}</div>
					</div>
				{/each}

				{#if weekData.gambler}
					{@const ga = weekData.gambler}
					<div class="award-card good">
						<div class="award-emoji">🎲</div>
						<div class="award-label">The Gambler</div>
						<div class="award-player">{ga.teamName}</div>
						<div class="award-meta">Started lower-projected players who delivered</div>
						<div class="award-score green">{ga.successfulGambles}</div>
						<div class="award-delta">starters who beat a higher-proj bench player</div>
					</div>
				{/if}

				{#if weekData.wrongMan}
					{@const wm = weekData.wrongMan}
					<div class="award-card bad">
						<div class="award-emoji">👥</div>
						<div class="award-label">Wrong Man</div>
						<div class="award-player">{wm.teamName}</div>
						<div class="award-meta">Started {wm.startedName} ({wm.startedScore.toFixed(1)}) over {wm.benchedName} ({wm.benchedScore.toFixed(1)})</div>
						<div class="award-score red">−{wm.pointsLeft.toFixed(2)}</div>
						<div class="award-delta">pts left on bench</div>
					</div>
				{/if}

				{#if weekData.luckyDevil}
					{@const ld = weekData.luckyDevil}
					<div class="award-card good">
						<div class="award-emoji">🍀</div>
						<div class="award-label">Lucky Devil</div>
						<div class="award-player">{ld.teamName}</div>
						<div class="award-meta">Lowest-scoring winner this week</div>
						<div class="award-score">{ld.actualScore.toFixed(2)}</div>
						<div class="award-delta">would've beaten only {ld.wouldHaveBeaten} of {ld.totalTeams - 1} other teams</div>
					</div>
				{/if}

				{#if weekData.mrMonopoly}
					{@const mm = weekData.mrMonopoly}
					<div class="award-card good">
						<div class="award-emoji">🎩</div>
						<div class="award-label">Mr. Monopoly</div>
						<div class="award-player">{mm.teamName}</div>
						<div class="award-meta">Took over the season points lead</div>
						<div class="award-score green">{mm.currentTotal.toFixed(2)}</div>
						<div class="award-delta">overtook {mm.prevLeaderName} · {mm.prevLeaderTotal.toFixed(2)}</div>
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
				</div>
			</details>

			<!-- Matchups -->
			{#each weekData.matchups as matchup}
				{@const isOptimal = showOptimal[matchup.matchupId] ?? false}
				{@const isBenchOpen = benchOpen[matchup.matchupId] ?? false}

				<div class="matchup-card {isOptimal ? 'optimal-mode' : ''}">
					<div class="matchup-header">
						<div class="score-line">
							<!-- Home -->
							<div class="team-score">
								<span class="team-name {matchup.winner === 'home' ? 'winner' : 'loser'} {matchup.home.totalPoints === topScore ? 'top-scorer' : ''} {matchup.home.totalPoints === bottomScore ? 'bottom-scorer' : ''}">{matchup.home.teamName}{matchup.home.totalPoints === bottomScore ? ' 💩' : ''}</span>
								{#each (teamAwardMap.get(matchup.home.teamId) ?? []) as emoji}<span class="team-award-badge">{emoji}</span>{/each}
								<span class="score {matchup.winner === 'home' ? 'winner' : 'loser'} {matchup.home.totalPoints === bottomScore ? 'bottom-scorer' : ''}">{matchup.home.totalPoints.toFixed(2)}</span>
							</div>
							<span class="vs">vs</span>
							<!-- Away -->
							{#if matchup.away}
								<div class="team-score">
									<span class="score {matchup.winner === 'away' ? 'winner' : 'loser'} {matchup.away.totalPoints === bottomScore ? 'bottom-scorer' : ''}">{matchup.away.totalPoints.toFixed(2)}</span>
									<span class="team-name {matchup.winner === 'away' ? 'winner' : 'loser'} {matchup.away.totalPoints === topScore ? 'top-scorer' : ''} {matchup.away.totalPoints === bottomScore ? 'bottom-scorer' : ''}">{matchup.away.teamName}{matchup.away.totalPoints === bottomScore ? ' 💩' : ''}</span>
								{#each (teamAwardMap.get(matchup.away.teamId) ?? []) as emoji}<span class="team-award-badge">{emoji}</span>{/each}
								</div>
							{/if}
						</div>

						<button
							class="cake-btn {isOptimal ? 'active' : ''}"
							on:click={() => toggleOptimal(matchup.matchupId)}
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
										<button class="bench-toggle" on:click={() => toggleBench(matchup.matchupId)}>
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
											<span class="actual norm" style="color:#00d26d">{t.optimalPoints.toFixed(2)}</span>
										</div>
									</div>

									<!-- Optimal bench: starters displaced by the optimal lineup -->
									{#if displacedFromOptimal(t).length > 0}
										<button class="bench-toggle" on:click={() => toggleBench(matchup.matchupId)}>
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
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}



		{:else}
			<div class="empty">No data found. Run the backfill to populate historical data.</div>
		{/if}
	</main>
</div>
