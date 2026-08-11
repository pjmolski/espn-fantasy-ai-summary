<script lang="ts">
	export let data: {
		currentTeams: { teamId: number; name: string; logoUrl?: string }[];
		earliestSeason: number | null;
		seasonResults: {
			seasonId: number; championshipWeek: number; historical?: boolean;
			first?:   { teamId: number; teamName: string; logoUrl?: string };
			second?:  { teamId: number; teamName: string; logoUrl?: string };
			third?:   { teamId: number; teamName: string; logoUrl?: string };
			chumpion?:{ teamId: number; teamName: string; logoUrl?: string };
		}[];
		winniestTeams:  { teamId: number; teamName: string; logoUrl?: string; count: number; years: number[] }[];
		chumpiestTeams: { teamId: number; teamName: string; logoUrl?: string; count: number; years: number[] }[];
		h2hSerialized: Record<string, { t1w: number; t2w: number; ties: number }>;
		tightestRivalries: { team1Id: number; team1Name: string; team1Logo?: string; team2Id: number; team2Name: string; team2Logo?: string; wins1: number; wins2: number; ties: number; total: number }[];
		lopsidedRivalries: { team1Id: number; team1Name: string; team1Logo?: string; team2Id: number; team2Name: string; team2Logo?: string; wins1: number; wins2: number; ties: number; total: number }[];
		blowouts:    { seasonId: number; week: number; winnerName: string; winnerScore: number; winnerLogo?: string; loserName: string; loserScore: number; loserLogo?: string; delta: number; combined: number }[];
		barnBurners: { seasonId: number; week: number; winnerName: string; winnerScore: number; winnerLogo?: string; loserName: string; loserScore: number; loserLogo?: string; delta: number; combined: number }[];
		weekPerf: Record<number, Record<number, { wins: number; losses: number }>>;
	};

	const { currentTeams, earliestSeason, seasonResults, winniestTeams, chumpiestTeams,
	        h2hSerialized, tightestRivalries, lopsidedRivalries, blowouts, barnBurners, weekPerf } = data;

	let activeTooltip: string | null = null;
	let selectedPerfTeamId: number = currentTeams[0]?.teamId ?? 0;
	const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K'];
	function toggleTooltip(id: string) { activeTooltip = activeTooltip === id ? null : id; }

	// ── H2H helpers ───────────────────────────────────────────────────────────
	function getH2H(t1: number, t2: number) {
		const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
		const rec = h2hSerialized[`${lo}-${hi}`];
		if (!rec) return { wins: 0, losses: 0, ties: 0 };
		return t1 === lo
			? { wins: rec.t1w, losses: rec.t2w, ties: rec.ties }
			: { wins: rec.t2w, losses: rec.t1w, ties: rec.ties };
	}

	// Combined all-time record for each team
	function teamOverallRecord(teamId: number) {
		let wins = 0, losses = 0, ties = 0;
		for (const [key, rec] of Object.entries(h2hSerialized)) {
			const [lo, hi] = key.split('-').map(Number);
			if (lo === teamId)      { wins += rec.t1w; losses += rec.t2w; ties += rec.ties; }
			else if (hi === teamId) { wins += rec.t2w; losses += rec.t1w; ties += rec.ties; }
		}
		return { wins, losses, ties };
	}

	// ── Matrix expand state ───────────────────────────────────────────────────
	let expandedCell: { rowTeamId: number; colTeamId: number } | null = null;
	let h2hCache: Record<string, any[]> = {};
	let h2hLoading: Record<string, boolean> = {};

	function matrixKey(t1: number, t2: number) {
		return `${Math.min(t1, t2)}-${Math.max(t1, t2)}`;
	}

	async function clickCell(rowTeamId: number, colTeamId: number) {
		if (rowTeamId === colTeamId) return;
		const same = expandedCell?.rowTeamId === rowTeamId && expandedCell?.colTeamId === colTeamId;
		if (same) { expandedCell = null; return; }
		expandedCell = { rowTeamId, colTeamId };
		const key = matrixKey(rowTeamId, colTeamId);
		if (!h2hCache[key] && !h2hLoading[key]) {
			h2hLoading = { ...h2hLoading, [key]: true };
			const res = await fetch(`/api/h2h?team1=${rowTeamId}&team2=${colTeamId}`);
			const json = await res.json();
			h2hCache = { ...h2hCache, [key]: json.matchups ?? [] };
			h2hLoading = { ...h2hLoading, [key]: false };
		}
	}

	function cellClass(t1: number, t2: number, isExpanded: boolean): string {
		if (t1 === t2) return 'cell diagonal';
		const { wins, losses } = getH2H(t1, t2);
		const base = wins > losses ? 'winning' : losses > wins ? 'losing' : wins === 0 && losses === 0 ? 'empty' : 'even';
		return `cell ${base}${isExpanded ? ' expanded' : ''}`;
	}

	// ── Rivalry helpers ───────────────────────────────────────────────────────
	function dominantTeam(r: typeof lopsidedRivalries[0]) {
		return r.wins1 >= r.wins2
			? { name: r.team1Name, logo: r.team1Logo, wins: r.wins1, losses: r.wins2, otherId: r.team2Id, otherName: r.team2Name, otherLogo: r.team2Logo }
			: { name: r.team2Name, logo: r.team2Logo, wins: r.wins2, losses: r.wins1, otherId: r.team1Id, otherName: r.team1Name, otherLogo: r.team1Logo };
	}
</script>

<svelte:head>
	<title>League History</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@100;200;300;400;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<div class="page">
<main>

	<!-- ── Champions + Chumpions ──────────────────────────────────────────── -->
	<section class="history-section">
		<h2 class="section-label">🏆 Season Results</h2>
		<div class="seasons-list">
			{#each seasonResults as sr}
				{@const recapHref = sr.historical ? undefined : `/?season=${sr.seasonId}&week=${sr.championshipWeek}`}
				<div class="season-block">
					<div class="season-year">{sr.seasonId}</div>
					<div class="season-places">
						{#if sr.first}
							<a class="place-row first" href={recapHref}>
								<span class="place-emoji">🔩</span>
								{#if sr.first.logoUrl}<img src={sr.first.logoUrl} alt="" class="team-logo" />{/if}
								<span class="place-name gold">{sr.first.teamName}</span>
							</a>
						{/if}
						{#if sr.second}
							<a class="place-row" href={recapHref}>
								<span class="place-emoji">🥈</span>
								{#if sr.second.logoUrl}<img src={sr.second.logoUrl} alt="" class="team-logo" />{/if}
								<span class="place-name">{sr.second.teamName}</span>
							</a>
						{/if}
						{#if sr.third}
							<a class="place-row" href={recapHref}>
								<span class="place-emoji">🥉</span>
								{#if sr.third.logoUrl}<img src={sr.third.logoUrl} alt="" class="team-logo" />{/if}
								<span class="place-name">{sr.third.teamName}</span>
							</a>
						{/if}
						{#if sr.chumpion}
							<a class="place-row chump" href={recapHref}>
								<span class="place-emoji">🪠</span>
								{#if sr.chumpion.logoUrl}<img src={sr.chumpion.logoUrl} alt="" class="team-logo" />{/if}
								<span class="place-name dim">{sr.chumpion.teamName}</span>
							</a>
						{/if}
					</div>
				</div>
			{:else}
				<p class="empty-note">No completed seasons yet.</p>
			{/each}
		</div>
	</section>

	<!-- ── Winningest / Chumpiest ─────────────────────────────────────────── -->
	<div class="two-col">
		<section class="history-section">
			<h2 class="section-label">🔩 Most Championships</h2>
			<div class="tally-list">
				{#each winniestTeams as t, i}
					<div class="tally-row">
						{#if t.logoUrl}<img src={t.logoUrl} alt="" class="team-logo" />{/if}
						<span
							class="tally-name has-tooltip"
							onclick={() => toggleTooltip(`champ-${i}`)}
							onkeydown={(e) => e.key === 'Enter' && toggleTooltip(`champ-${i}`)}
							role="button" tabindex="0"
						>
							{t.teamName}
							<span class="tooltip" class:visible={activeTooltip === `champ-${i}`}>{t.years.join(', ')}</span>
						</span>
						<span class="tally-count gold">{t.count}</span>
					</div>
				{:else}
					<p class="empty-note">No data yet.</p>
				{/each}
			</div>
		</section>
		<section class="history-section">
			<h2 class="section-label">🪠 Most Chumpionships</h2>
			<div class="tally-list">
				{#each chumpiestTeams as t, i}
					<div class="tally-row">
						{#if t.logoUrl}<img src={t.logoUrl} alt="" class="team-logo" />{/if}
						<span
							class="tally-name has-tooltip"
							onclick={() => toggleTooltip(`chump-${i}`)}
							onkeydown={(e) => e.key === 'Enter' && toggleTooltip(`chump-${i}`)}
							role="button" tabindex="0"
						>
							{t.teamName}
							<span class="tooltip" class:visible={activeTooltip === `chump-${i}`}>{t.years.join(', ')}</span>
						</span>
						<span class="tally-count dim">{t.count}</span>
					</div>
				{:else}
					<p class="empty-note">No data yet.</p>
				{/each}
			</div>
		</section>
	</div>

	<!-- ── H2H Matrix ─────────────────────────────────────────────────────── -->
	<section class="history-section">
		<h2 class="section-label">📊 All-Time Head-to-Head</h2>
		<p class="section-note">Click any cell to see the game-by-game history. Record shown from the row team's perspective.</p>
		<div class="matrix-scroll">
			<table class="matrix">
				<thead>
					<tr>
						<th class="corner"></th>
						{#each currentTeams as col}
							{@const overall = teamOverallRecord(col.teamId)}
							<th class="col-header" title="{col.name}">
								{#if col.logoUrl}<img src={col.logoUrl} alt="" class="col-logo" />{/if}
								<span class="col-name">{col.name}</span>
								<span class="col-id">({col.teamId})</span>
								<span class="col-record">{overall.wins}-{overall.losses}</span>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each currentTeams as row, rowIdx}
						{@const rowOverall = teamOverallRecord(row.teamId)}
						<tr class="matrix-row">
							<td class="row-header">
								{#if row.logoUrl}<img src={row.logoUrl} alt="" class="row-logo" />{/if}
								<div class="row-text">
									<span class="row-name">{row.name}</span>
									<span class="row-sub">({row.teamId}) · {rowOverall.wins}-{rowOverall.losses} vs league</span>
								</div>
							</td>
							{#each currentTeams as col}
								{@const isExpanded = expandedCell?.rowTeamId === row.teamId && expandedCell?.colTeamId === col.teamId}
								<td
									class={cellClass(row.teamId, col.teamId, isExpanded)}
									onclick={() => clickCell(row.teamId, col.teamId)}
									title={row.teamId !== col.teamId ? `${row.name} vs ${col.name}` : ''}
								>
									{#if row.teamId === col.teamId}
										<span class="dash">—</span>
									{:else}
										{@const { wins, losses, ties } = getH2H(row.teamId, col.teamId)}
										<span class="cell-record">{wins}-{losses}{ties ? `-${ties}` : ''}</span>
									{/if}
								</td>
							{/each}
						</tr>
						{#if expandedCell?.rowTeamId === row.teamId}
							{@const key = matrixKey(row.teamId, expandedCell.colTeamId)}
							{@const games = h2hCache[key] ?? []}
							{@const loading = h2hLoading[key]}
							{@const t1 = currentTeams.find(t => t.teamId === expandedCell!.rowTeamId)}
							{@const t2 = currentTeams.find(t => t.teamId === expandedCell!.colTeamId)}
							<tr class="expand-row">
								<td colspan={currentTeams.length + 1} class="expand-cell">
									<div class="expand-header">
										{#if t1 && t2}
											{@const { wins, losses, ties } = getH2H(t1.teamId, t2.teamId)}
											<span>🏛️ <strong>{t1.name}</strong> {wins}–{losses}{ties ? `–${ties}` : ''} <strong>{t2.name}</strong></span>
										{/if}
										<button class="expand-close" onclick={() => expandedCell = null}>✕</button>
									</div>
									{#if loading}
										<p class="expand-loading">Loading…</p>
									{:else if games.length === 0}
										<p class="expand-loading">No matchups found.</p>
									{:else}
										<div class="expand-games">
											{#each games as game}
												{@const homeWon = game.winner === 'home'}
												{@const lo2 = Math.min(game.homeTeamId, game.awayTeamId)}
												{@const hi2 = Math.max(game.homeTeamId, game.awayTeamId)}
												<a class="h2h-row" href="/?season={game.seasonId}&week={game.week}#matchup-{lo2}-{hi2}">
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
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- ── Heated Rivalries ───────────────────────────────────────────────── -->
	<section class="history-section">
		<h2 class="section-label">👯‍♀️ Heated Rivalries</h2>
		<p class="section-note">Most evenly matched all-time records (min. 3 games).</p>
		<div class="stat-list">
			{#each tightestRivalries as r, i}
				<div class="stat-row">
					<span class="stat-rank">{i + 1}</span>
					<span class="stat-main">
						{#if r.team1Logo}<img src={r.team1Logo} alt="" class="team-logo" />{/if}
						<span class="rival-name">{r.team1Name}</span>
						<span class="rival-record">{r.wins1}-{r.wins2}{r.ties ? `-${r.ties}` : ''}</span>
						{#if r.team2Logo}<img src={r.team2Logo} alt="" class="team-logo" />{/if}
						<span class="rival-name">{r.team2Name}</span>
					</span>
					<span class="stat-meta">{r.total} games</span>
				</div>
			{:else}
				<p class="empty-note">Not enough data yet.</p>
			{/each}
		</div>
	</section>

	<!-- ── Lopsided Rivalries ─────────────────────────────────────────────── -->
	<section class="history-section">
		<h2 class="section-label">🫥 I Don't Think About You At All</h2>
		<p class="section-note">Most one-sided all-time records (min. 3 games).</p>
		<div class="stat-list">
			{#each lopsidedRivalries as r, i}
				{@const dom = dominantTeam(r)}
				<div class="stat-row">
					<span class="stat-rank">{i + 1}</span>
					<span class="stat-main">
						{#if dom.logo}<img src={dom.logo} alt="" class="team-logo" />{/if}
						<span class="rival-name dominant">{dom.name}</span>
						<span class="rival-record dominant-record">{dom.wins}-{dom.losses}{r.ties ? `-${r.ties}` : ''}</span>
						{#if dom.otherLogo}<img src={dom.otherLogo} alt="" class="team-logo subdued-logo" />{/if}
						<span class="rival-name subdued">{dom.otherName}</span>
					</span>
					<span class="stat-meta">{r.total} games</span>
				</div>
			{:else}
				<p class="empty-note">Not enough data yet.</p>
			{/each}
		</div>
	</section>

	<!-- ── Biggest Blowouts ───────────────────────────────────────────────── -->
	<section class="history-section">
		<h2 class="section-label">👟🐛 Biggest Blowouts</h2>
		<p class="section-note">Historic matchups with the largest margin of victory.</p>
		<div class="game-list">
			{#each blowouts as g, i}
				<a class="game-row" href="/?season={g.seasonId}&week={g.week}">
					<span class="game-rank">{i + 1}</span>
					<span class="game-meta">{g.seasonId} · Wk {g.week}</span>
					<span class="game-matchup">
						{#if g.winnerLogo}<img src={g.winnerLogo} alt="" class="team-logo" />{/if}
						<span class="game-winner">{g.winnerName}</span>
						<span class="game-score">{g.winnerScore.toFixed(1)} – {g.loserScore.toFixed(1)}</span>
						{#if g.loserLogo}<img src={g.loserLogo} alt="" class="team-logo subdued-logo" />{/if}
						<span class="game-loser">{g.loserName}</span>
					</span>
					<span class="game-stat">+{g.delta.toFixed(1)}</span>
				</a>
			{:else}
				<p class="empty-note">No data yet.</p>
			{/each}
		</div>
	</section>

	<!-- ── Barn Burners ───────────────────────────────────────────────────── -->
	<section class="history-section">
		<h2 class="section-label">🐄🔥 Barn Burners</h2>
		<p class="section-note">Historic matchups with the highest combined scores.</p>
		<div class="game-list">
			{#each barnBurners as g, i}
				<a class="game-row" href="/?season={g.seasonId}&week={g.week}">
					<span class="game-rank">{i + 1}</span>
					<span class="game-meta">{g.seasonId} · Wk {g.week}</span>
					<span class="game-matchup">
						{#if g.winnerLogo}<img src={g.winnerLogo} alt="" class="team-logo" />{/if}
						<span class="game-winner">{g.winnerName}</span>
						<span class="game-score">{g.winnerScore.toFixed(1)} – {g.loserScore.toFixed(1)}</span>
						{#if g.loserLogo}<img src={g.loserLogo} alt="" class="team-logo subdued-logo" />{/if}
						<span class="game-loser">{g.loserName}</span>
					</span>
					<span class="game-stat">{g.combined.toFixed(1)} pts</span>
				</a>
			{:else}
				<p class="empty-note">No data yet.</p>
			{/each}
		</div>
	</section>

	<!-- ── Performance by Week ──────────────────────────────────────────────── -->
	<section class="history-section">
		<h2 class="section-title">Performance by Week</h2>
		<div class="pbw-controls">
			<select class="pbw-select" bind:value={selectedPerfTeamId}>
				{#each currentTeams as t}
					<option value={t.teamId}>{t.name}</option>
				{/each}
			</select>
		</div>
		{#if selectedPerfTeamId}
		{@const pbwPerf = weekPerf[selectedPerfTeamId] ?? {}}
		{@const pbwWeeks = Array.from({ length: 17 }, (_, i) => i + 1)}
		{@const pbwValues = pbwWeeks.map(w => { const d = pbwPerf[w]; return d ? d.wins - d.losses : null; })}
		{@const pbwMax = Math.max(1, ...pbwValues.filter(v => v !== null).map(v => Math.abs(v)))}
		{@const PBW_W = 700}
		{@const PBW_H = 220}
		{@const PBW_PL = 36}
		{@const PBW_PR = 12}
		{@const PBW_PT = 16}
		{@const PBW_PB = 32}
		{@const PBW_PW = PBW_W - PBW_PL - PBW_PR}
		{@const PBW_PH = PBW_H - PBW_PT - PBW_PB}
		{@const barW = PBW_PW / 17}
		{@const midY = PBW_PT + PBW_PH / 2}
		<svg viewBox="0 0 {PBW_W} {PBW_H}" class="pbw-svg">
			<line x1={PBW_PL} y1={midY} x2={PBW_PL + PBW_PW} y2={midY} stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
			<text class="pbw-axis" x={PBW_PL - 4} y={PBW_PT + 4} text-anchor="end">+{pbwMax}</text>
			<text class="pbw-axis" x={PBW_PL - 4} y={midY + 4} text-anchor="end">0</text>
			<text class="pbw-axis" x={PBW_PL - 4} y={PBW_PT + PBW_PH + 4} text-anchor="end">-{pbwMax}</text>
			{#each pbwWeeks as week, wi}
				{@const val = pbwValues[wi]}
				{@const cx = PBW_PL + wi * barW + barW / 2}
				{#if val === null}
					<text x={cx} y={PBW_PT + PBW_PH + 22} text-anchor="middle" font-size="13" class="pbw-nodata">
						<title>Can't find anything here!</title>
						🔬
					</text>
				{:else}
					{@const barH = Math.max(val === 0 ? 1 : Math.abs(val) / pbwMax * (PBW_PH / 2), 1)}
					{@const barY = val >= 0 ? midY - barH : midY}
					<rect
						x={cx - barW * 0.35} y={barY}
						width={barW * 0.7} height={barH}
						fill={val > 0 ? '#00d26d' : val < 0 ? '#e74c3c' : 'rgba(255,255,255,0.2)'}
						rx="2"
					/>
					{#if val !== 0}
						<text
							x={cx} y={val > 0 ? barY - 3 : barY + barH + 11}
							text-anchor="middle" class="pbw-val {val > 0 ? 'pos' : 'neg'}"
						>{val > 0 ? '+' : ''}{val}</text>
					{/if}
					<text x={cx} y={PBW_PT + PBW_PH + 22} text-anchor="middle" class="pbw-axis">{week}</text>
				{/if}
			{/each}
			<text class="pbw-axis" x={PBW_PL + PBW_PW / 2} y={PBW_H} text-anchor="middle">Week</text>
		</svg>
		{/if}
	</section>



</main>
</div>

<style>
	:global(*) { box-sizing: border-box; margin: 0; padding: 0; }
	:global(body) {
		font-family: 'Raleway', sans-serif;
		background: #303030;
		color: #fff;
		font-size: 15px;
		line-height: 1.5;
	}

	.page { min-height: 100vh; }
	main { max-width: 960px; margin: 0 auto; padding: 28px 24px 80px; }

	.disclaimer {
		font-size: 11px;
		color: rgba(255,255,255,0.3);
		margin-bottom: 32px;
		letter-spacing: 0.3px;
	}

	.history-section { margin-bottom: 48px; }

	.section-label {
		font-size: 13px; font-weight: 700; letter-spacing: 1px;
		text-transform: uppercase; color: #00d26d; margin-bottom: 6px;
	}
	.section-note { font-size: 12px; color: rgba(255,255,255,0.35); margin-bottom: 14px; }
	.empty-note { font-size: 13px; color: rgba(255,255,255,0.3); }

	.team-logo { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
	.subdued-logo { opacity: 0.4; }

	/* ── Season results ─────────────────────────────────────────── */
	.seasons-list { display: flex; flex-direction: column; gap: 20px; }
	.season-block { display: flex; gap: 20px; align-items: flex-start; }
	.season-year { font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.35); min-width: 38px; padding-top: 6px; }
	.season-places { display: flex; flex-direction: column; gap: 2px; flex: 1; }

	.place-row {
		display: flex; align-items: center; gap: 8px;
		padding: 5px 10px; border-radius: 4px;
		text-decoration: none; color: inherit;
	}
	.place-row:hover { background: rgba(255,255,255,0.05); }
	.place-emoji { font-size: 14px; width: 20px; text-align: center; flex-shrink: 0; }
	.place-name { font-size: 13px; }
	.place-name.gold { font-weight: 700; color: #ffcc33; }
	.place-name.dim { color: rgba(255,255,255,0.4); }

	/* ── Two-column layout ──────────────────────────────────────── */
	.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 48px; }
	@media (max-width: 600px) { .two-col { grid-template-columns: 1fr; } }

	.tally-list { display: flex; flex-direction: column; gap: 4px; }
	.tally-row { display: flex; align-items: center; gap: 10px; padding: 5px 10px; border-radius: 4px; }
	.tally-row:nth-child(odd) { background: rgba(255,255,255,0.02); }
	.tally-name { flex: 1; font-size: 13px; font-weight: 600; }
	.tally-count { font-size: 18px; font-weight: 700; }
	.tally-count.gold { color: #ffcc33; }
	.tally-count.dim { color: rgba(255,255,255,0.35); }

	.has-tooltip { position: relative; cursor: default; }
	.tooltip {
		position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
		background: #1a1a1a; border: 1px solid rgba(255,255,255,0.12);
		color: rgba(255,255,255,0.75); font-size: 11px; font-weight: 400;
		white-space: nowrap; padding: 4px 8px; border-radius: 4px;
		pointer-events: none; opacity: 0; transition: opacity 0.15s;
		z-index: 10;
	}
	.has-tooltip:hover .tooltip,
	.tooltip.visible { opacity: 1; }

	/* ── Matrix ─────────────────────────────────────────────────── */
	.matrix-scroll { overflow-x: auto; }
	.matrix { border-collapse: collapse; font-size: 11px; white-space: nowrap; }

	.corner { width: 160px; }

	.col-header {
		padding: 6px 6px 8px; text-align: center;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		min-width: 72px; vertical-align: bottom;
	}
	.col-logo { display: block; width: 20px; height: 20px; border-radius: 50%; object-fit: cover; margin: 0 auto 3px; }
	.col-name { display: block; font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6); overflow: hidden; text-overflow: ellipsis; max-width: 70px; }
	.col-id { display: block; font-size: 9px; color: rgba(255,255,255,0.25); }
	.col-record { display: block; font-size: 9px; color: rgba(255,255,255,0.2); margin-top: 1px; }

	.row-header {
		padding: 6px 10px 6px 0; text-align: right;
		border-right: 1px solid rgba(255,255,255,0.08);
		max-width: 160px;
		display: flex; align-items: center; gap: 8px; justify-content: flex-end;
	}
	.row-logo { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
	.row-text { display: flex; flex-direction: column; align-items: flex-end; }
	.row-name { font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.7); }
	.row-sub { font-size: 9px; color: rgba(255,255,255,0.25); }

	.cell {
		padding: 6px 8px; text-align: center;
		border: 1px solid rgba(255,255,255,0.05);
		cursor: pointer; transition: background 0.1s;
	}
	.cell:hover:not(.diagonal) { background: rgba(255,255,255,0.08); }
	.cell.diagonal { background: rgba(255,255,255,0.03); cursor: default; }
	.cell.expanded { background: rgba(0,210,109,0.12); border-color: rgba(0,210,109,0.3); }
	.cell-record { font-weight: 600; }
	.cell.winning .cell-record { color: #00d26d; }
	.cell.losing .cell-record  { color: rgba(255,90,70,0.8); }
	.cell.even .cell-record    { color: rgba(255,204,51,0.9); }
	.cell.empty .cell-record   { color: rgba(255,255,255,0.2); }
	.dash { color: rgba(255,255,255,0.12); }

	.expand-row td { padding: 0; }
	.expand-cell {
		background: #1e1e1e;
		border: 1px solid rgba(0,210,109,0.2);
		border-radius: 4px;
		padding: 12px;
	}
	.expand-header {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 12px; font-size: 13px; color: rgba(255,255,255,0.7);
	}
	.expand-close { background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer; font-size: 14px; padding: 2px 6px; }
	.expand-close:hover { color: rgba(255,255,255,0.7); }
	.expand-loading { font-size: 12px; color: rgba(255,255,255,0.3); padding: 8px 0; }
	.expand-games { display: flex; flex-direction: column; gap: 2px; }

	.h2h-row { display: flex; align-items: center; gap: 10px; padding: 5px 6px; border-radius: 4px; text-decoration: none; color: inherit; }
	.h2h-row:hover { background: rgba(255,255,255,0.05); }
	.h2h-meta { font-size: 11px; color: rgba(255,255,255,0.3); min-width: 80px; }
	.h2h-teams { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; }
	.h2h-winner { font-weight: 700; color: rgba(255,255,255,0.85); }
	.h2h-loser  { color: rgba(255,255,255,0.3); }
	.h2h-score  { color: rgba(255,255,255,0.4); font-size: 11px; }

	/* ── Stat lists (rivalries) ─────────────────────────────────── */
	.stat-list { display: flex; flex-direction: column; gap: 2px; }
	.stat-row {
		display: flex; align-items: center; gap: 10px;
		padding: 8px 12px; border-radius: 4px;
	}
	.stat-row:nth-child(odd) { background: rgba(255,255,255,0.02); }
	.stat-rank { font-size: 11px; color: rgba(255,255,255,0.25); min-width: 18px; text-align: right; }
	.stat-main { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; }
	.rival-name { font-weight: 600; }
	.rival-record { font-size: 12px; color: rgba(255,204,51,0.85); font-weight: 700; }
	.dominant { color: rgba(255,255,255,0.9); }
	.dominant-record { color: #00d26d; }
	.subdued { color: rgba(255,255,255,0.4); }
	.stat-meta { font-size: 11px; color: rgba(255,255,255,0.25); white-space: nowrap; }

	/* ── Game lists ─────────────────────────────────────────────── */
	.game-list { display: flex; flex-direction: column; gap: 2px; }
	.game-row {
		display: flex; align-items: center; gap: 10px;
		padding: 8px 12px; border-radius: 4px;
		text-decoration: none; color: inherit;
	}
	.game-row:nth-child(odd) { background: rgba(255,255,255,0.02); }
	.game-row:hover { background: rgba(255,255,255,0.05); }
	.game-rank  { font-size: 11px; color: rgba(255,255,255,0.25); min-width: 18px; text-align: right; }
	.game-meta  { font-size: 11px; color: rgba(255,255,255,0.3); min-width: 70px; white-space: nowrap; }
	.game-matchup { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; flex-wrap: wrap; }
	.game-winner { font-weight: 700; color: rgba(255,255,255,0.85); }
	.game-score  { color: rgba(255,255,255,0.4); font-size: 11px; }
	.game-loser  { color: rgba(255,255,255,0.35); }
	.game-stat   { font-size: 12px; font-weight: 700; color: #00d26d; white-space: nowrap; }
	/* ── Performance by Week ───────────────────────────────────── */
	.pbw-controls { margin-bottom: 16px; }
	.pbw-select {
		background: rgba(255,255,255,0.06);
		color: var(--fg, #fff);
		border: 1px solid rgba(255,255,255,0.15);
		border-radius: 6px;
		padding: 6px 10px;
		font-size: 14px;
		cursor: pointer;
	}
	.pbw-svg { width: 100%; max-width: 700px; display: block; overflow: visible; }
	.pbw-axis { fill: rgba(255,255,255,0.3); font-size: 10px; font-family: inherit; }
	.pbw-val { font-size: 10px; font-weight: 700; font-family: inherit; }
	.pbw-val.pos { fill: #00d26d; }
	.pbw-val.neg { fill: #e74c3c; }
	.pbw-nodata { fill: rgba(255,255,255,0.25); cursor: default; font-family: inherit; }

</style>
