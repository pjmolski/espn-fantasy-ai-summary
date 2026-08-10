<script lang="ts">
	export let data: {
		currentTeams: { teamId: number; name: string }[];
		champions: { seasonId: number; teamId: number; teamName: string; championshipWeek: number }[];
		chumpions: { seasonId: number; teamId: number; teamName: string; championshipWeek: number }[];
		h2hSerialized: Record<string, { t1w: number; t2w: number; ties: number }>;
		tightestRivalries: { team1Id: number; team1Name: string; team2Id: number; team2Name: string; wins1: number; wins2: number; ties: number; total: number }[];
		lopsidedRivalries: { team1Id: number; team1Name: string; team2Id: number; team2Name: string; wins1: number; wins2: number; ties: number; total: number }[];
		blowouts: { seasonId: number; week: number; winnerName: string; winnerScore: number; loserName: string; loserScore: number; delta: number; combined: number }[];
		barnBurners: { seasonId: number; week: number; winnerName: string; winnerScore: number; loserName: string; loserScore: number; delta: number; combined: number }[];
	};

	const { currentTeams, champions, chumpions, h2hSerialized, tightestRivalries, lopsidedRivalries, blowouts, barnBurners } = data;

	// H2H matrix helpers
	function getH2H(t1Id: number, t2Id: number): { wins: number; losses: number; ties: number } {
		const lo = Math.min(t1Id, t2Id), hi = Math.max(t1Id, t2Id);
		const rec = h2hSerialized[`${lo}-${hi}`];
		if (!rec) return { wins: 0, losses: 0, ties: 0 };
		const wins = t1Id === lo ? rec.t1w : rec.t2w;
		const losses = t1Id === lo ? rec.t2w : rec.t1w;
		return { wins, losses, ties: rec.ties };
	}

	// Matrix expand state
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

	function cellClass(t1Id: number, t2Id: number): string {
		if (t1Id === t2Id) return 'cell diagonal';
		const { wins, losses } = getH2H(t1Id, t2Id);
		const total = wins + losses;
		if (total === 0) return 'cell empty';
		if (wins > losses) return 'cell winning';
		if (losses > wins) return 'cell losing';
		return 'cell even';
	}

	// Rivalry display helpers
	function rivalRecord(r: typeof tightestRivalries[0], perspective: 1 | 2): string {
		return perspective === 1
			? `${r.wins1}-${r.wins2}${r.ties ? `-${r.ties}` : ''}`
			: `${r.wins2}-${r.wins1}${r.ties ? `-${r.ties}` : ''}`;
	}
	function dominantTeam(r: typeof lopsidedRivalries[0]) {
		return r.wins1 >= r.wins2
			? { name: r.team1Name, wins: r.wins1, losses: r.wins2 }
			: { name: r.team2Name, wins: r.wins2, losses: r.wins1 };
	}
</script>

<svelte:head>
	<title>League History</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@100;200;300;400;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<div class="page">
	<div class="top-bar">
		<a href="/" class="back-link">← Week Recap</a>
		<h1 class="page-title">League History</h1>
	</div>

	<main>

		<!-- ── Champions ──────────────────────────────────────── -->
		<section class="history-section">
			<h2 class="section-label">🏆 Champions</h2>
			<div class="winner-list">
				{#each champions as c, i}
					<a class="winner-row" href="/?season={c.seasonId}&week={c.championshipWeek}">
						<span class="winner-rank">{i + 1}</span>
						<span class="winner-season">{c.seasonId}</span>
						<span class="winner-name">{c.teamName}</span>
					</a>
				{:else}
					<p class="empty-note">No completed seasons yet.</p>
				{/each}
			</div>
		</section>

		<!-- ── Chumpionship ───────────────────────────────────── -->
		<section class="history-section">
			<h2 class="section-label">🚽 Chumpionship Winners</h2>
			<div class="winner-list">
				{#each chumpions as c, i}
					<a class="winner-row chump" href="/?season={c.seasonId}&week={c.championshipWeek}">
						<span class="winner-rank">{i + 1}</span>
						<span class="winner-season">{c.seasonId}</span>
						<span class="winner-name">{c.teamName}</span>
					</a>
				{:else}
					<p class="empty-note">No completed seasons yet.</p>
				{/each}
			</div>
		</section>

		<!-- ── H2H Matrix ─────────────────────────────────────── -->
		<section class="history-section">
			<h2 class="section-label">📊 All-Time Head-to-Head</h2>
			<p class="section-note">Click any cell to see the game history. Record shown from the row team's perspective.</p>
			<div class="matrix-scroll">
				<table class="matrix">
					<thead>
						<tr>
							<th class="corner"></th>
							{#each currentTeams as col}
								<th class="col-header" title="{col.name}">
									<span class="col-name">{col.name}</span>
									<span class="col-id">({col.teamId})</span>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each currentTeams as row, rowIdx}
							<tr class="matrix-row">
								<td class="row-header">
									<span class="row-name">{row.name}</span>
									<span class="row-id">({row.teamId})</span>
								</td>
								{#each currentTeams as col}
									{@const isExpanded = expandedCell?.rowTeamId === row.teamId && expandedCell?.colTeamId === col.teamId}
									<td
										class="{cellClass(row.teamId, col.teamId)} {isExpanded ? 'expanded' : ''}"
										onclick={() => clickCell(row.teamId, col.teamId)}
										title="{row.teamId !== col.teamId ? `${row.name} vs ${col.name}` : ''}"
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
							<!-- Expanded H2H panel after this row -->
							{#if expandedCell?.rowTeamId === row.teamId}
								{@const key = matrixKey(row.teamId, expandedCell.colTeamId)}
								{@const games = h2hCache[key] ?? []}
								{@const loading = h2hLoading[key]}
								{@const t1 = currentTeams.find(t => t.teamId === expandedCell!.rowTeamId)}
								{@const t2 = currentTeams.find(t => t.teamId === expandedCell!.colTeamId)}
								<tr class="expand-row">
									<td colspan="{currentTeams.length + 1}" class="expand-cell">
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

		<!-- ── Heated Rivalries ───────────────────────────────── -->
		<section class="history-section">
			<h2 class="section-label">💃🕺 Heated Rivalries</h2>
			<p class="section-note">Most evenly matched all-time records (min. 3 games).</p>
			<div class="stat-list">
				{#each tightestRivalries as r, i}
					<div class="stat-row">
						<span class="stat-rank">{i + 1}</span>
						<span class="stat-main">
							<span class="rival-name">{r.team1Name}</span>
							<span class="rival-record">{r.wins1}-{r.wins2}{r.ties ? `-${r.ties}` : ''}</span>
							<span class="rival-name">{r.team2Name}</span>
						</span>
						<span class="stat-meta">{r.total} games</span>
					</div>
				{:else}
					<p class="empty-note">Not enough data yet.</p>
				{/each}
			</div>
		</section>

		<!-- ── Lopsided Rivalries ─────────────────────────────── -->
		<section class="history-section">
			<h2 class="section-label">🫥 I Don't Think About You At All</h2>
			<p class="section-note">Most one-sided all-time records (min. 3 games).</p>
			<div class="stat-list">
				{#each lopsidedRivalries as r, i}
					{@const dom = dominantTeam(r)}
					<div class="stat-row">
						<span class="stat-rank">{i + 1}</span>
						<span class="stat-main">
							<span class="rival-name dominant">{dom.name}</span>
							<span class="rival-record dominant-record">{dom.wins}-{dom.losses}{r.ties ? `-${r.ties}` : ''}</span>
							<span class="rival-name subdued">{dom.name === r.team1Name ? r.team2Name : r.team1Name}</span>
						</span>
						<span class="stat-meta">{r.total} games</span>
					</div>
				{:else}
					<p class="empty-note">Not enough data yet.</p>
				{/each}
			</div>
		</section>

		<!-- ── Biggest Blowouts ───────────────────────────────── -->
		<section class="history-section">
			<h2 class="section-label">👟🐛 Biggest Blowouts</h2>
			<div class="game-list">
				{#each blowouts as g, i}
					<a class="game-row" href="/?season={g.seasonId}&week={g.week}">
						<span class="game-rank">{i + 1}</span>
						<span class="game-meta">{g.seasonId} · Wk {g.week}</span>
						<span class="game-matchup">
							<span class="game-winner">{g.winnerName}</span>
							<span class="game-score">{g.winnerScore.toFixed(1)} – {g.loserScore.toFixed(1)}</span>
							<span class="game-loser">{g.loserName}</span>
						</span>
						<span class="game-stat">+{g.delta.toFixed(1)}</span>
					</a>
				{:else}
					<p class="empty-note">No data yet.</p>
				{/each}
			</div>
		</section>

		<!-- ── Barn Burners ───────────────────────────────────── -->
		<section class="history-section">
			<h2 class="section-label">🐄🔥 Barn Burners</h2>
			<p class="section-note">Highest combined scores in league history.</p>
			<div class="game-list">
				{#each barnBurners as g, i}
					<a class="game-row" href="/?season={g.seasonId}&week={g.week}">
						<span class="game-rank">{i + 1}</span>
						<span class="game-meta">{g.seasonId} · Wk {g.week}</span>
						<span class="game-matchup">
							<span class="game-winner">{g.winnerName}</span>
							<span class="game-score">{g.winnerScore.toFixed(1)} – {g.loserScore.toFixed(1)}</span>
							<span class="game-loser">{g.loserName}</span>
						</span>
						<span class="game-stat">{g.combined.toFixed(1)} pts</span>
					</a>
				{:else}
					<p class="empty-note">No data yet.</p>
				{/each}
			</div>
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

	.top-bar {
		background: #1e1e1e;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		padding: 12px 40px;
		display: flex;
		align-items: center;
		gap: 20px;
	}
	.back-link {
		color: rgba(255,255,255,0.45);
		text-decoration: none;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}
	.back-link:hover { color: rgba(255,255,255,0.8); }
	.page-title {
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 0.5px;
		color: #fff;
	}

	main { max-width: 900px; margin: 0 auto; padding: 32px 24px 80px; }

	.history-section { margin-bottom: 48px; }

	.section-label {
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 1px;
		text-transform: uppercase;
		color: #00d26d;
		margin-bottom: 6px;
	}
	.section-note {
		font-size: 12px;
		color: rgba(255,255,255,0.35);
		margin-bottom: 14px;
	}
	.empty-note { font-size: 13px; color: rgba(255,255,255,0.3); }

	/* ── Winners lists ─────────────────────────── */
	.winner-list { display: flex; flex-direction: column; gap: 2px; }
	.winner-row {
		display: flex; align-items: center; gap: 14px;
		padding: 8px 12px; border-radius: 4px;
		text-decoration: none; color: inherit;
	}
	.winner-row:hover { background: rgba(255,255,255,0.05); }
	.winner-rank { font-size: 11px; color: rgba(255,255,255,0.3); min-width: 18px; text-align: right; }
	.winner-season { font-size: 12px; color: rgba(255,255,255,0.4); min-width: 38px; }
	.winner-name { font-size: 14px; font-weight: 600; color: #ffcc33; }
	.winner-row.chump .winner-name { color: rgba(255,255,255,0.6); }

	/* ── Matrix ───────────────────────────────── */
	.matrix-scroll { overflow-x: auto; }
	.matrix { border-collapse: collapse; font-size: 11px; white-space: nowrap; }

	.corner { width: 130px; }
	.col-header {
		padding: 4px 6px; text-align: center;
		border-bottom: 1px solid rgba(255,255,255,0.08);
		min-width: 70px; max-width: 90px;
	}
	.col-name { display: block; font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6); overflow: hidden; text-overflow: ellipsis; }
	.col-id { display: block; font-size: 9px; color: rgba(255,255,255,0.25); }

	.row-header {
		padding: 6px 10px 6px 0; text-align: right;
		border-right: 1px solid rgba(255,255,255,0.08);
		max-width: 130px;
	}
	.row-name { display: block; font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.7); overflow: hidden; text-overflow: ellipsis; }
	.row-id { display: block; font-size: 9px; color: rgba(255,255,255,0.25); }

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
	.cell.losing .cell-record { color: rgba(255,90,70,0.8); }
	.cell.even .cell-record { color: rgba(255,204,51,0.9); }
	.cell.empty .cell-record { color: rgba(255,255,255,0.2); }
	.dash { color: rgba(255,255,255,0.12); }

	/* Expanded panel */
	.expand-row td { padding: 0; }
	.expand-cell {
		background: #1e1e1e;
		border: 1px solid rgba(0,210,109,0.2);
		border-radius: 4px;
		padding: 14px 16px;
	}
	.expand-header {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 12px;
		font-size: 13px; color: rgba(255,255,255,0.7);
	}
	.expand-close {
		background: none; border: none; color: rgba(255,255,255,0.3);
		cursor: pointer; font-size: 14px; padding: 2px 6px;
	}
	.expand-close:hover { color: rgba(255,255,255,0.7); }
	.expand-loading { font-size: 12px; color: rgba(255,255,255,0.3); padding: 8px 0; }
	.expand-games { display: flex; flex-direction: column; gap: 2px; }

	.h2h-row { display: flex; align-items: center; gap: 10px; padding: 5px 6px; border-radius: 4px; text-decoration: none; color: inherit; }
	.h2h-row:hover { background: rgba(255,255,255,0.05); }
	.h2h-meta { font-size: 11px; color: rgba(255,255,255,0.3); min-width: 80px; }
	.h2h-teams { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; }
	.h2h-winner { font-weight: 700; color: rgba(255,255,255,0.85); }
	.h2h-loser { color: rgba(255,255,255,0.3); }
	.h2h-score { color: rgba(255,255,255,0.4); font-size: 11px; }

	/* ── Rivalry & game lists ─────────────────── */
	.stat-list, .game-list { display: flex; flex-direction: column; gap: 2px; }

	.stat-row {
		display: flex; align-items: center; gap: 12px;
		padding: 8px 12px; border-radius: 4px;
	}
	.stat-row:nth-child(odd) { background: rgba(255,255,255,0.02); }
	.stat-rank { font-size: 11px; color: rgba(255,255,255,0.25); min-width: 18px; text-align: right; }
	.stat-main { flex: 1; display: flex; align-items: center; gap: 10px; font-size: 13px; }
	.rival-name { font-weight: 600; }
	.rival-record { font-size: 12px; color: rgba(255,204,51,0.85); font-weight: 700; }
	.dominant { color: rgba(255,255,255,0.9); }
	.dominant-record { color: #00d26d; }
	.subdued { color: rgba(255,255,255,0.4); }
	.stat-meta { font-size: 11px; color: rgba(255,255,255,0.25); white-space: nowrap; }

	.game-row {
		display: flex; align-items: center; gap: 12px;
		padding: 8px 12px; border-radius: 4px;
		text-decoration: none; color: inherit;
	}
	.game-row:hover { background: rgba(255,255,255,0.04); }
	.game-row:nth-child(odd) { background: rgba(255,255,255,0.02); }
	.game-row:nth-child(odd):hover { background: rgba(255,255,255,0.05); }
	.game-rank { font-size: 11px; color: rgba(255,255,255,0.25); min-width: 18px; text-align: right; }
	.game-meta { font-size: 11px; color: rgba(255,255,255,0.3); min-width: 70px; white-space: nowrap; }
	.game-matchup { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; }
	.game-winner { font-weight: 700; color: rgba(255,255,255,0.85); }
	.game-score { color: rgba(255,255,255,0.4); font-size: 11px; }
	.game-loser { color: rgba(255,255,255,0.35); }
	.game-stat { font-size: 12px; font-weight: 700; color: #00d26d; white-space: nowrap; }
</style>
