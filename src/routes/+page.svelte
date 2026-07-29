<script lang="ts">
	import type { ProcessedWeek, ProcessedMatchup, ProcessedTeam, ProcessedPlayer } from '$lib/weekProcessor';

	export let data: {
		availableWeeks: Array<{ seasonId: number; scoringPeriodId: number; isPlayoff: boolean }>;
		weekData: ProcessedWeek | null;
		error?: string;
	};

	let weekData: ProcessedWeek | null = data.weekData;
	let loading = false;

	// Week selector state
	$: currentSeason = weekData?.seasonId ?? data.availableWeeks[0]?.seasonId;
	$: currentWeek = weekData?.scoringPeriodId ?? data.availableWeeks[0]?.scoringPeriodId;
	$: weeksBySeason = groupWeeksBySeason(data.availableWeeks);

	function groupWeeksBySeason(weeks: typeof data.availableWeeks) {
		const map = new Map<number, typeof data.availableWeeks>();
		for (const w of weeks) {
			if (!map.has(w.seasonId)) map.set(w.seasonId, []);
			map.get(w.seasonId)!.push(w);
		}
		return map;
	}

	async function loadWeek(seasonId: number, week: number) {
		if (seasonId === currentSeason && week === currentWeek) return;
		loading = true;
		try {
			const res = await fetch(`/api/week-data?season=${seasonId}&week=${week}`);
			weekData = await res.json();
		} catch (e) {
			console.error(e);
		} finally {
			loading = false;
		}
	}

	// Per-matchup tab state (results vs optimal)
	let activeTabs: Record<number, 'results' | 'optimal'> = {};
	function getTab(matchupId: number) { return activeTabs[matchupId] ?? 'results'; }
	function setTab(matchupId: number, tab: 'results' | 'optimal') {
		activeTabs = { ...activeTabs, [matchupId]: tab };
	}

	function ordinal(n: number) {
		const s = ['th','st','nd','rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	}

	function sign(n: number) { return n >= 0 ? '+' : ''; }

	function winnerOf(m: ProcessedMatchup): ProcessedTeam | null {
		if (m.winner === 'home') return m.home;
		if (m.winner === 'away') return m.away ?? null;
		return null;
	}
	function loserOf(m: ProcessedMatchup): ProcessedTeam | null {
		if (m.winner === 'home') return m.away ?? null;
		if (m.winner === 'away') return m.home;
		return null;
	}

	$: seasons = [...(weeksBySeason?.keys() ?? [])].sort((a, b) => b - a);

	function optimalWouldWin(team: ProcessedTeam, matchup: ProcessedMatchup): boolean {
		const opponentScore = team === matchup.home
			? (matchup.away?.totalPoints ?? 0)
			: matchup.home.totalPoints;
		return team.optimalPoints > opponentScore;
	}

	function teamActuallyWon(team: ProcessedTeam, matchup: ProcessedMatchup): boolean {
		return (team === matchup.home && matchup.winner === 'home') ||
			   (team === matchup.away && matchup.winner === 'away');
	}
</script>

<svelte:head>
	<title>MANDEM! 🏈</title>
</svelte:head>

<div class="min-h-screen bg-gray-950 text-gray-100">

	<!-- Header -->
	<header class="bg-gray-900 border-b border-gray-800 px-4 py-4">
		<div class="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
			<h1 class="text-2xl font-bold text-green-400 tracking-tight">MANDEM! 🏈</h1>

			<!-- Week selector -->
			<div class="flex items-center gap-2 flex-wrap">
				<select
					class="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-green-500"
					bind:value={currentSeason}
					on:change={() => {
						const weeks = weeksBySeason.get(currentSeason) ?? [];
						if (weeks.length > 0) loadWeek(currentSeason, weeks[0].scoringPeriodId);
					}}
				>
					{#each seasons as s}
						<option value={s}>{s} Season</option>
					{/each}
				</select>

				<select
					class="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-green-500"
					bind:value={currentWeek}
					on:change={() => loadWeek(currentSeason, currentWeek)}
				>
					{#each (weeksBySeason.get(currentSeason) ?? []).slice().reverse() as w}
						<option value={w.scoringPeriodId}>
							{w.isPlayoff ? '🏆' : ''} Week {w.scoringPeriodId}
						</option>
					{/each}
				</select>
			</div>
		</div>
	</header>

	<main class="max-w-5xl mx-auto px-4 py-6">

		{#if data.error}
			<div class="bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300">{data.error}</div>

		{:else if loading}
			<div class="flex items-center justify-center py-24 text-gray-400">Loading...</div>

		{:else if weekData}
			<!-- Week header -->
			<div class="mb-6">
				<h2 class="text-lg text-gray-400">
					{weekData.seasonId} Season · {weekData.isPlayoffWeek ? '🏆 Playoffs ·' : ''} Week {weekData.scoringPeriodId}
				</h2>
			</div>

			<!-- Matchups -->
			<div class="space-y-4 mb-10">
				{#each weekData.matchups as matchup}
					{@const winner = winnerOf(matchup)}
					{@const loser = loserOf(matchup)}
					{@const tab = getTab(matchup.matchupId)}

					<div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

						<!-- Matchup header -->
						<div class="px-5 py-4 border-b border-gray-800">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div class="flex items-center gap-3 flex-wrap">
									<!-- Home team -->
									<div class="flex items-center gap-1.5">
										{#if matchup.home.isLuckiest}
											<span title="Luckiest win">🍀</span>
										{/if}
										<span class="font-semibold {matchup.winner === 'home' ? 'text-white' : 'text-gray-400'}">
											{matchup.home.teamName}
										</span>
										<span class="text-xl font-bold {matchup.winner === 'home' ? 'text-green-400' : 'text-gray-500'}">
											{matchup.home.totalPoints.toFixed(2)}
										</span>
									</div>

									<span class="text-gray-600 text-sm">vs</span>

									<!-- Away team -->
									{#if matchup.away}
										<div class="flex items-center gap-1.5">
											<span class="text-xl font-bold {matchup.winner === 'away' ? 'text-green-400' : 'text-gray-500'}">
												{matchup.away.totalPoints.toFixed(2)}
											</span>
											<span class="font-semibold {matchup.winner === 'away' ? 'text-white' : 'text-gray-400'}">
												{matchup.away.isLuckiest ? '🍀 ' : ''}{matchup.away.teamName}
											</span>
										</div>
									{/if}
								</div>

								<!-- Tabs -->
								<div class="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
									<button
										class="px-3 py-1 {tab === 'results' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}"
										on:click={() => setTab(matchup.matchupId, 'results')}
									>Results</button>
									<button
										class="px-3 py-1 {tab === 'optimal' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}"
										on:click={() => setTab(matchup.matchupId, 'optimal')}
									>Optimal</button>
								</div>
							</div>
						</div>

						<!-- Tab content -->
						<div class="px-5 py-4">
							{#if tab === 'results'}
								<!-- Results: side-by-side rosters -->
								<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
									{#each [matchup.home, matchup.away].filter(Boolean) as team}
										{@const t = team as ProcessedTeam}
										<div>
											<div class="flex items-center justify-between mb-2">
												<span class="text-sm font-medium text-gray-300">{t.teamName}</span>
												<span class="text-xs text-gray-500">
													Optimal: {t.optimalPoints.toFixed(2)}
													{#if t.pointsLeftOnBench > 0}
														<span class="text-amber-500"> (+{t.pointsLeftOnBench.toFixed(1)} left on bench)</span>
													{/if}
												</span>
											</div>

											<!-- Starters -->
											<div class="space-y-1">
												{#each t.starters.sort((a, b) => {
													const order = ['QB','RB','WR','TE','FLEX','D/ST','K'];
													return order.indexOf(a.slotName) - order.indexOf(b.slotName);
												}) as p}
													<div class="flex items-center justify-between text-sm py-0.5">
														<div class="flex items-center gap-2 min-w-0">
															<span class="text-xs text-gray-500 w-10 shrink-0">{p.slotName}</span>
															<span class="text-gray-200 truncate">{p.fullName}</span>
															{#if p.injuryStatus !== 'ACTIVE'}
																<span class="text-xs px-1 rounded {p.injuryStatus === 'OUT' ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}">{p.injuryStatus[0]}</span>
															{/if}
														</div>
														<div class="flex items-center gap-2 shrink-0 ml-2">
															<span class="text-gray-400 text-xs">proj {p.projectedScore.toFixed(1)}</span>
															<span class="font-medium w-12 text-right {p.actualScore > p.projectedScore ? 'text-green-400' : p.actualScore < p.projectedScore * 0.7 ? 'text-red-400' : 'text-gray-200'}">
																{p.actualScore.toFixed(2)}
															</span>
														</div>
													</div>
												{/each}
											</div>

											<!-- Bench (collapsed) -->
											{#if t.bench.filter(p => p.slotName !== 'IR').length > 0}
												<details class="mt-2">
													<summary class="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">Bench</summary>
													<div class="mt-1 space-y-0.5 pl-2 border-l border-gray-800">
														{#each t.bench.filter(p => p.slotName !== 'IR') as p}
															<div class="flex items-center justify-between text-xs text-gray-500 py-0.5">
																<span class="truncate">{p.fullName}</span>
																<span class="ml-2">{p.actualScore.toFixed(2)}</span>
															</div>
														{/each}
													</div>
												</details>
											{/if}

											<!-- Would have beaten -->
											<div class="mt-3 text-xs text-gray-500">
												Would've beaten <span class="text-gray-300 font-medium">{t.wouldHaveBeaten}/{t.totalTeams - 1}</span> teams this week
												{#if t.isLuckiest}
													<span class="text-green-400"> · 🍀 luckiest win</span>
												{/if}
											</div>
										</div>
									{/each}
								</div>

							{:else}
								<!-- Optimal lineup comparison -->
								<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
									{#each [matchup.home, matchup.away].filter(Boolean) as team}
										{@const t = team as ProcessedTeam}
										<div>
											<div class="flex items-center justify-between mb-2">
												<span class="text-sm font-medium text-gray-300">{t.teamName}</span>
												<div class="text-xs">
													<span class="text-gray-500">Actual: {t.totalPoints.toFixed(2)}</span>
													<span class="mx-1 text-gray-700">→</span>
													<span class="text-green-400 font-medium">Optimal: {t.optimalPoints.toFixed(2)}</span>
												</div>
											</div>
											<div class="space-y-1">
												{#each t.optimalStarters.sort((a, b) => {
													const order = ['QB','RB','WR','TE','FLEX','D/ST','K'];
													return order.indexOf(a.slotName) - order.indexOf(b.slotName);
												}) as p}
													{@const wasActuallyStarted = t.starters.some(s => s.playerId === p.playerId)}
													<div class="flex items-center justify-between text-sm py-0.5 {!wasActuallyStarted ? 'bg-amber-900/20 -mx-1 px-1 rounded' : ''}">
														<div class="flex items-center gap-2 min-w-0">
															<span class="text-xs text-gray-500 w-10 shrink-0">{p.position}</span>
															<span class="truncate {!wasActuallyStarted ? 'text-amber-300' : 'text-gray-200'}">{p.fullName}</span>
															{#if !wasActuallyStarted}
																<span class="text-xs text-amber-600">benched</span>
															{/if}
														</div>
														<span class="font-medium w-12 text-right text-green-400 shrink-0 ml-2">{p.actualScore.toFixed(2)}</span>
													</div>
												{/each}
											</div>

											{#if optimalWouldWin(t, matchup) !== teamActuallyWon(t, matchup)}
												<div class="mt-2 text-xs {optimalWouldWin(t, matchup) ? 'text-green-400' : 'text-red-400'}">
													{optimalWouldWin(t, matchup) ? '✓ Would have won with optimal lineup' : '✗ Would have lost even with optimal lineup'}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<!-- League awards -->
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">

				<!-- Golden Apple -->
				{#if weekData.goldenApple}
					{@const g = weekData.goldenApple}
					<div class="bg-gray-900 border border-gray-800 rounded-xl p-4">
						<div class="text-2xl mb-1">🍎</div>
						<div class="text-xs text-gray-500 uppercase tracking-wide mb-1">Golden Apple</div>
						<div class="font-semibold text-white">{g.playerName}</div>
						<div class="text-xs text-gray-400">{g.position} · {g.teamName}</div>
						<div class="mt-2 text-green-400 font-bold text-lg">{g.actualScore.toFixed(2)}</div>
						<div class="text-xs text-gray-500">proj {g.projectedScore.toFixed(1)} · <span class="text-green-400">{sign(g.delta)}{g.delta.toFixed(1)}</span></div>
					</div>
				{/if}

				<!-- Brown Banana -->
				{#if weekData.brownBanana}
					{@const b = weekData.brownBanana}
					<div class="bg-gray-900 border border-gray-800 rounded-xl p-4">
						<div class="text-2xl mb-1">🍌</div>
						<div class="text-xs text-gray-500 uppercase tracking-wide mb-1">Brown Banana</div>
						<div class="font-semibold text-white">{b.playerName}</div>
						<div class="text-xs text-gray-400">{b.position} · {b.teamName}</div>
						<div class="mt-2 text-red-400 font-bold text-lg">{b.actualScore.toFixed(2)}</div>
						<div class="text-xs text-gray-500">proj {b.projectedScore.toFixed(1)} · <span class="text-red-400">{sign(b.delta)}{b.delta.toFixed(1)}</span></div>
					</div>
				{/if}

				<!-- Lamest Stud -->
				{#if weekData.lamentStud}
					{@const l = weekData.lamentStud}
					<div class="bg-gray-900 border border-gray-800 rounded-xl p-4">
						<div class="text-2xl mb-1">🤡</div>
						<div class="text-xs text-gray-500 uppercase tracking-wide mb-1">Lamest Stud</div>
						<div class="font-semibold text-white">{l.playerName}</div>
						<div class="text-xs text-gray-400">{l.position} · {l.teamName}</div>
						<div class="mt-2 text-red-400 font-bold text-lg">{l.actualScore.toFixed(2)}</div>
						<div class="text-xs text-gray-500">{ordinal(l.overallPick)} overall pick (Rd {l.draftRound})</div>
					</div>
				{/if}

			</div>

		{:else}
			<div class="text-center py-24 text-gray-500">
				No data found. Run the backfill to populate historical data.
			</div>
		{/if}
	</main>
</div>
