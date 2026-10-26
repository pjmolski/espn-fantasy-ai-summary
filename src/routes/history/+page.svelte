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
		weekPerf: Record<number, Record<number, { wins: number; losses: number; winSeasons: number[]; lossSeasons: number[] }>>;
		allTimeStats: {
			teamId: number; teamName: string; logoUrl?: string;
			w: number; l: number; pct: number;
			pf: number; pa: number; apf: number; apa: number;
			hi: number; lo: number;
			lrW: number; lrL: number; lrT: number;
			streak: string; seed: number;
		}[];
	};

	const { currentTeams, earliestSeason, seasonResults, winniestTeams, chumpiestTeams,
	        h2hSerialized, tightestRivalries, lopsidedRivalries, blowouts, barnBurners, weekPerf, allTimeStats } = data;

	let atStatsOpen = false;

	type AtSortCol = 'seed' | 'w' | 'l' | 'pct' | 'streak' | 'pf' | 'pa' | 'apf' | 'apa' | 'hi' | 'lo' | 'lrW';
	let atSortCol: AtSortCol = 'seed';
	let atSortDir: 'asc' | 'desc' = 'asc';

	function setAtSort(col: AtSortCol) {
		if (atSortCol === col) atSortDir = atSortDir === 'desc' ? 'asc' : 'desc';
		else { atSortCol = col; atSortDir = col === 'seed' || col === 'l' ? 'asc' : 'desc'; }
	}

	$: atSorted = (() => {
		const rows = [...allTimeStats];
		const dir = atSortDir === 'desc' ? -1 : 1;
		rows.sort((a, b) => {
			let va: number, vb: number;
			if (atSortCol === 'streak') {
				const sv = (s: string) => { const n = parseInt(s.slice(1)); return s.startsWith('W') ? n : -n; };
				return dir * (sv(a.streak) - sv(b.streak));
			}
			if (atSortCol === 'lrW') {
				const lrPct = (r: typeof a) => { const t = r.lrW + r.lrL + r.lrT; return t > 0 ? (r.lrW + r.lrT * 0.5) / t : 0; };
				return dir * (lrPct(a) - lrPct(b));
			}
			va = a[atSortCol] as number; vb = b[atSortCol] as number;
			return dir * (va - vb);
		});
		return rows;
	})();

	// Per-column highlights for all-time stats
	$: atHighlights = (() => {
		const rows = allTimeStats;
		const result: Record<string, Map<number, string>> = {};
		const specs = [
			{ key: 'w',   val: (r: typeof rows[0]) => r.w,   hi: 'st-hi', lo: '' },
			{ key: 'l',   val: (r: typeof rows[0]) => r.l,   hi: '',      lo: 'st-lo' },
			{ key: 'pct', val: (r: typeof rows[0]) => r.pct, hi: 'st-hi', lo: 'st-lo' },
			{ key: 'pf',  val: (r: typeof rows[0]) => r.pf,  hi: 'st-hi', lo: 'st-lo' },
			{ key: 'pa',  val: (r: typeof rows[0]) => r.pa,  hi: 'st-hi', lo: 'st-lo' },
			{ key: 'apf', val: (r: typeof rows[0]) => r.apf, hi: 'st-hi', lo: 'st-lo' },
			{ key: 'apa', val: (r: typeof rows[0]) => r.apa, hi: 'st-hi', lo: 'st-lo' },
			{ key: 'hi',  val: (r: typeof rows[0]) => r.hi,  hi: 'st-hi', lo: 'st-lo' },
			{ key: 'lo',  val: (r: typeof rows[0]) => r.lo,  hi: 'st-hi', lo: 'st-lo' },
			{ key: 'lr',  val: (r: typeof rows[0]) => { const t = r.lrW + r.lrL + r.lrT; return t > 0 ? (r.lrW + r.lrT * 0.5) / t : 0; }, hi: 'st-hi', lo: 'st-lo' },
		];
		for (const { key, val, hi, lo } of specs) {
			const vals = rows.map(r => val(r));
			const max = Math.max(...vals), min = Math.min(...vals);
			const m = new Map<number, string>();
			for (const r of rows) {
				const v = val(r);
				m.set(r.teamId, v === max && hi ? hi : v === min && lo ? lo : '');
			}
			result[key] = m;
		}
		return result;
	})();

	function logoInitials(name: string): string {
		const words = name.trim().split(/\s+/).filter(Boolean);
		if (words.length === 1) return words[0].slice(0, 2);
		return (words[0][0] + words[words.length - 1][0]).toUpperCase();
	}
	const imgErr = (e: Event) => {
		const img = e.currentTarget as HTMLImageElement;
		img.style.display = 'none';
		(img.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'inline-flex');
	};

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
								{#if sr.first.logoUrl}<img src={sr.first.logoUrl} alt={sr.first.teamName} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(sr.first.teamName)}</span>{:else}<span class="logo-init sm">{logoInitials(sr.first.teamName)}</span>{/if}
								<span class="place-name gold">{sr.first.teamName}</span>
							</a>
						{/if}
						{#if sr.second}
							<a class="place-row" href={recapHref}>
								<span class="place-emoji">🥈</span>
								{#if sr.second.logoUrl}<img src={sr.second.logoUrl} alt={sr.second.teamName} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(sr.second.teamName)}</span>{:else}<span class="logo-init sm">{logoInitials(sr.second.teamName)}</span>{/if}
								<span class="place-name">{sr.second.teamName}</span>
							</a>
						{/if}
						{#if sr.third}
							<a class="place-row" href={recapHref}>
								<span class="place-emoji">🥉</span>
								{#if sr.third.logoUrl}<img src={sr.third.logoUrl} alt={sr.third.teamName} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(sr.third.teamName)}</span>{:else}<span class="logo-init sm">{logoInitials(sr.third.teamName)}</span>{/if}
								<span class="place-name">{sr.third.teamName}</span>
							</a>
						{/if}
						{#if sr.chumpion}
							<a class="place-row chump" href={recapHref}>
								<span class="place-emoji">🪠</span>
								{#if sr.chumpion.logoUrl}<img src={sr.chumpion.logoUrl} alt={sr.chumpion.teamName} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(sr.chumpion.teamName)}</span>{:else}<span class="logo-init sm">{logoInitials(sr.chumpion.teamName)}</span>{/if}
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
						{#if t.logoUrl}<img src={t.logoUrl} alt={t.teamName} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(t.teamName)}</span>{:else}<span class="logo-init sm">{logoInitials(t.teamName)}</span>{/if}
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
						{#if t.logoUrl}<img src={t.logoUrl} alt={t.teamName} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(t.teamName)}</span>{:else}<span class="logo-init sm">{logoInitials(t.teamName)}</span>{/if}
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
								{#if col.logoUrl}<img src={col.logoUrl} alt={col.name} class="col-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(col.name)}</span>{:else}<span class="logo-init sm">{logoInitials(col.name)}</span>{/if}
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
								{#if row.logoUrl}<img src={row.logoUrl} alt={row.name} class="row-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(row.name)}</span>{:else}<span class="logo-init sm">{logoInitials(row.name)}</span>{/if}
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
						{#if r.team1Logo}<img src={r.team1Logo} alt={r.team1Name} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(r.team1Name)}</span>{:else}<span class="logo-init sm">{logoInitials(r.team1Name)}</span>{/if}
						<span class="rival-name">{r.team1Name}</span>
						<span class="rival-record">{r.wins1}-{r.wins2}{r.ties ? `-${r.ties}` : ''}</span>
						{#if r.team2Logo}<img src={r.team2Logo} alt={r.team2Name} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(r.team2Name)}</span>{:else}<span class="logo-init sm">{logoInitials(r.team2Name)}</span>{/if}
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
						{#if dom.logo}<img src={dom.logo} alt={dom.name} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(dom.name)}</span>{:else}<span class="logo-init sm">{logoInitials(dom.name)}</span>{/if}
						<span class="rival-name dominant">{dom.name}</span>
						<span class="rival-record dominant-record">{dom.wins}-{dom.losses}{r.ties ? `-${r.ties}` : ''}</span>
						{#if dom.otherLogo}<img src={dom.otherLogo} alt={dom.otherName} class="team-logo subdued-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(dom.otherName)}</span>{:else}<span class="logo-init sm">{logoInitials(dom.otherName)}</span>{/if}
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
						{#if g.winnerLogo}<img src={g.winnerLogo} alt={g.winnerName} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(g.winnerName)}</span>{:else}<span class="logo-init sm">{logoInitials(g.winnerName)}</span>{/if}
						<span class="game-winner">{g.winnerName}</span>
						<span class="game-score">{g.winnerScore.toFixed(1)} – {g.loserScore.toFixed(1)}</span>
						{#if g.loserLogo}<img src={g.loserLogo} alt={g.loserName} class="team-logo subdued-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(g.loserName)}</span>{:else}<span class="logo-init sm">{logoInitials(g.loserName)}</span>{/if}
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
						{#if g.winnerLogo}<img src={g.winnerLogo} alt={g.winnerName} class="team-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(g.winnerName)}</span>{:else}<span class="logo-init sm">{logoInitials(g.winnerName)}</span>{/if}
						<span class="game-winner">{g.winnerName}</span>
						<span class="game-score">{g.winnerScore.toFixed(1)} – {g.loserScore.toFixed(1)}</span>
						{#if g.loserLogo}<img src={g.loserLogo} alt={g.loserName} class="team-logo subdued-logo" loading="lazy" onerror={imgErr} /><span class="logo-init sm" style="display:none">{logoInitials(g.loserName)}</span>{:else}<span class="logo-init sm">{logoInitials(g.loserName)}</span>{/if}
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
		{@const pbwMax = Math.max(1, ...pbwWeeks.flatMap(w => { const d = pbwPerf[w]; return d ? [d.wins, d.losses] : []; }))}
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
		{@const half = PBW_PH / 2}
		<svg viewBox="0 0 {PBW_W} {PBW_H}" class="pbw-svg">
			<line x1={PBW_PL} y1={midY} x2={PBW_PL + PBW_PW} y2={midY} stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
			<text class="pbw-axis" x={PBW_PL - 4} y={PBW_PT + 4} text-anchor="end">{pbwMax}</text>
			<text class="pbw-axis" x={PBW_PL - 4} y={midY + 4} text-anchor="end">0</text>
			<text class="pbw-axis" x={PBW_PL - 4} y={PBW_PT + PBW_PH + 4} text-anchor="end">{pbwMax}</text>
			{#each pbwWeeks as week, wi}
				{@const d = pbwPerf[week]}
				{@const cx = PBW_PL + wi * barW + barW / 2}
				{@const bx = cx - barW * 0.35}
				{@const bw = barW * 0.7}
				{#if !d}
					<text x={cx} y={PBW_PT + PBW_PH + 22} text-anchor="middle" font-size="13" class="pbw-nodata">
						<title>Can't find anything here!</title>🔬
					</text>
				{:else}
					{@const wH = Math.max(d.wins / pbwMax * half, d.wins > 0 ? 1 : 0)}
					{@const lH = Math.max(d.losses / pbwMax * half, d.losses > 0 ? 1 : 0)}
					{@const delta = d.wins - d.losses}
					{@const deltaH = Math.abs(delta) / pbwMax * half}
					<!-- Grey win bar (full wins, going up) -->
					{#if d.wins > 0}
					<g>
						<title>W: {d.winSeasons.slice().sort((a,b)=>a-b).join(', ')}</title>
						<rect x={bx} y={midY - wH} width={bw} height={wH} fill="rgba(255,255,255,0.15)" rx="2"/>
					</g>
					{/if}
					<!-- Grey loss bar (full losses, going down) -->
					{#if d.losses > 0}
					<g>
						<title>L: {d.lossSeasons.slice().sort((a,b)=>a-b).join(', ')}</title>
						<rect x={bx} y={midY} width={bw} height={lH} fill="rgba(255,255,255,0.15)" rx="2"/>
					</g>
					{/if}
					<!-- Delta highlight (green = top of win bar, red = bottom of loss bar) -->
					{#if delta > 0}
						<rect x={bx} y={midY - wH} width={bw} height={deltaH} fill="#00d26d" rx="2"/>
					{:else if delta < 0}
						<rect x={bx} y={midY + lH - deltaH} width={bw} height={deltaH} fill="#e74c3c" rx="2"/>
					{/if}
					<!-- Delta value label -->
					{#if delta !== 0}
						<text
							x={cx} y={delta > 0 ? midY - wH - 3 : midY + lH + 11}
							text-anchor="middle" class="pbw-val {delta > 0 ? 'pos' : 'neg'}"
						>{delta > 0 ? '+' : ''}{delta}</text>
					{/if}
					<text x={cx} y={PBW_PT + PBW_PH + 22} text-anchor="middle" class="pbw-axis">{week}</text>
				{/if}
			{/each}
			<text class="pbw-axis" x={PBW_PL + PBW_PW / 2} y={PBW_H} text-anchor="middle">Week</text>
		</svg>
		{/if}
	</section>



	<!-- ── All-Time Stats ───────────────────────────────────────────────────── -->
	<section class="history-section">
		<h2 class="section-title">📊 All-Time Stats</h2>
		<p class="section-note">Aggregated across all league history. Only active matchup weeks — no bye weeks.</p>
		<button class="at-stats-toggle" onclick={() => atStatsOpen = !atStatsOpen}>
			<span>{atStatsOpen ? 'Hide table' : 'Show table'}</span>
			<span class="at-stats-chevron {atStatsOpen ? 'open' : ''}">▾</span>
		</button>
		{#if atStatsOpen}
		<div class="standings-wrap">
			<table class="standings-table">
				<thead>
					<tr>
						<th class="st-sortable {atSortCol === 'seed' ? 'st-active' : ''}" title="Rank" onclick={() => setAtSort('seed')}>#<span class="st-chevron {atSortCol === 'seed' ? '' : 'st-chevron-inactive'}">{atSortCol === 'seed' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-team" title="Team">Team</th>
						<th class="st-sortable {atSortCol === 'w' ? 'st-active' : ''}" title="Wins" onclick={() => setAtSort('w')}>W<span class="st-chevron {atSortCol === 'w' ? '' : 'st-chevron-inactive'}">{atSortCol === 'w' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'l' ? 'st-active' : ''}" title="Losses" onclick={() => setAtSort('l')}>L<span class="st-chevron {atSortCol === 'l' ? '' : 'st-chevron-inactive'}">{atSortCol === 'l' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'pct' ? 'st-active' : ''}" title="Win %" onclick={() => setAtSort('pct')}>%<span class="st-chevron {atSortCol === 'pct' ? '' : 'st-chevron-inactive'}">{atSortCol === 'pct' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'streak' ? 'st-active' : ''}" title="Current streak" onclick={() => setAtSort('streak')}>Stk<span class="st-chevron {atSortCol === 'streak' ? '' : 'st-chevron-inactive'}">{atSortCol === 'streak' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'pf' ? 'st-active' : ''}" title="Points For (total)" onclick={() => setAtSort('pf')}>PF<span class="st-chevron {atSortCol === 'pf' ? '' : 'st-chevron-inactive'}">{atSortCol === 'pf' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'pa' ? 'st-active' : ''}" title="Points Against (total)" onclick={() => setAtSort('pa')}>PA<span class="st-chevron {atSortCol === 'pa' ? '' : 'st-chevron-inactive'}">{atSortCol === 'pa' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'apf' ? 'st-active' : ''}" title="Avg Points For per week" onclick={() => setAtSort('apf')}>APF<span class="st-chevron {atSortCol === 'apf' ? '' : 'st-chevron-inactive'}">{atSortCol === 'apf' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'apa' ? 'st-active' : ''}" title="Avg Points Against per week" onclick={() => setAtSort('apa')}>APA<span class="st-chevron {atSortCol === 'apa' ? '' : 'st-chevron-inactive'}">{atSortCol === 'apa' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'hi' ? 'st-active' : ''}" title="Best single-week score" onclick={() => setAtSort('hi')}>Hi<span class="st-chevron {atSortCol === 'hi' ? '' : 'st-chevron-inactive'}">{atSortCol === 'hi' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'lo' ? 'st-active' : ''}" title="Worst single-week score" onclick={() => setAtSort('lo')}>Lo<span class="st-chevron {atSortCol === 'lo' ? '' : 'st-chevron-inactive'}">{atSortCol === 'lo' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
						<th class="st-sortable {atSortCol === 'lrW' ? 'st-active' : ''}" title="League Record (all-play)" onclick={() => setAtSort('lrW')}>LR<span class="st-chevron {atSortCol === 'lrW' ? '' : 'st-chevron-inactive'}">{atSortCol === 'lrW' ? (atSortDir === 'desc' ? '▼' : '▲') : '⇕'}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each atSorted as row}
						{@const lrTotal = row.lrW + row.lrL + row.lrT}
						{@const lrPct = lrTotal > 0 ? (row.lrW + row.lrT * 0.5) / lrTotal : 0}
						<tr class="st-row">
							<td class="st-seed">{row.seed}</td>
							<td class="st-team-cell">
								{#if row.logoUrl}
									<img class="lr-logo" src={row.logoUrl} alt={row.teamName} onerror={(e) => (e.currentTarget as HTMLImageElement).style.display='none'} loading="lazy" />
								{:else}
									<span class="logo-init sm">{logoInitials(row.teamName)}</span>
								{/if}
								<span class="st-name">{row.teamName}</span>
							</td>
							<td class="st-w {atHighlights['w']?.get(row.teamId) ?? ''}">{row.w}</td>
							<td class="st-l {atHighlights['l']?.get(row.teamId) ?? ''}">{row.l}</td>
							<td class="st-pct {atHighlights['pct']?.get(row.teamId) ?? ''}">{(row.pct * 100).toFixed(1)}%</td>
							<td class="st-streak {row.streak.startsWith('W') ? 'st-streak-w' : row.streak.startsWith('L') ? 'st-streak-l' : ''}">{row.streak}</td>
							<td class="st-num {atHighlights['pf']?.get(row.teamId) ?? ''}">{row.pf.toFixed(2)}</td>
							<td class="st-num {atHighlights['pa']?.get(row.teamId) ?? ''}">{row.pa.toFixed(2)}</td>
							<td class="st-num {atHighlights['apf']?.get(row.teamId) ?? ''}">{row.apf.toFixed(2)}</td>
							<td class="st-num {atHighlights['apa']?.get(row.teamId) ?? ''}">{row.apa.toFixed(2)}</td>
							<td class="st-num {atHighlights['hi']?.get(row.teamId) ?? ''}">{row.hi.toFixed(2)}</td>
							<td class="st-num {atHighlights['lo']?.get(row.teamId) ?? ''}">{row.lo.toFixed(2)}</td>
							<td class="st-lr {atHighlights['lr']?.get(row.teamId) ?? ''}">{row.lrW}-{row.lrL}{row.lrT > 0 ? `-${row.lrT}` : ''} <span class="st-lr-pct">({(lrPct * 100).toFixed(0)}%)</span></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
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

	.logo-init {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: rgba(255,255,255,0.12);
		color: var(--text);
		font-weight: 700;
		flex-shrink: 0;
		text-transform: uppercase;
		width: 22px; height: 22px; font-size: 9px;
	}
	.logo-init.sm { width: 22px; height: 22px; font-size: 9px; }
	.col-logo-init { width: 20px; height: 20px; font-size: 8px; display: block; margin: 0 auto 3px; }
	.row-logo-init { width: 20px; height: 20px; font-size: 8px; }
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

	/* ── All-Time Stats table ───────────────────────────────────── */
	.at-stats-toggle {
		display: flex; align-items: center; justify-content: space-between;
		width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
		border-radius: 6px; padding: 8px 12px; cursor: pointer; color: rgba(255,255,255,0.7);
		font-size: 13px; font-family: inherit; margin-bottom: 8px;
	}
	.at-stats-toggle:hover { background: rgba(255,255,255,0.07); }
	.at-stats-chevron { transition: transform 0.15s; }
	.at-stats-chevron.open { transform: rotate(180deg); }
	.standings-wrap { overflow-x: auto; }
	.standings-table { border-collapse: collapse; width: 100%; font-size: 12px; }
	.standings-table thead tr { border-bottom: 1px solid rgba(255,255,255,0.08); }
	.standings-table th {
		padding: 6px 8px; text-align: center; font-size: 11px;
		color: rgba(255,255,255,0.4); font-weight: 600; white-space: nowrap; cursor: default;
	}
	.standings-table th.st-team { text-align: left; }
	.st-sortable { cursor: pointer; }
	.st-sortable:hover { color: rgba(255,255,255,0.8); }
	.st-active { color: rgba(255,255,255,0.9) !important; }
	.st-chevron { margin-left: 2px; font-size: 0.65rem; }
	.st-chevron-inactive { opacity: 0.3; }
	.st-row { border-bottom: 1px solid rgba(255,255,255,0.04); }
	.st-row:hover { background: rgba(255,255,255,0.04); }
	.st-row td { padding: 6px 8px; text-align: center; color: rgba(255,255,255,0.7); }
	.st-row td.st-team-cell {
		text-align: left; display: flex; align-items: center; gap: 6px;
		white-space: nowrap;
	}
	.st-seed { color: rgba(255,255,255,0.25) !important; font-size: 0.75rem; width: 1.5rem; }
	.st-name { font-size: 12px; font-weight: 600; }
	.st-num { font-variant-numeric: tabular-nums; }
	.st-lr { font-variant-numeric: tabular-nums; white-space: nowrap; }
	.st-lr-pct { font-size: 10px; color: rgba(255,255,255,0.35); }
	.st-streak-w { color: #4ade80 !important; font-weight: 700; }
	.st-streak-l { color: #ef4444 !important; font-weight: 700; }
	:global(.st-hi) { color: #4ade80 !important; font-weight: 700; }
	:global(.st-lo) { color: #ef4444 !important; font-weight: 700; }
	.lr-logo { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }

</style>
