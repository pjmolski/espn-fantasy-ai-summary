<script lang="ts">
	import { goto } from '$app/navigation';
	import type { WeekEntry } from '$lib/fantasyDataService';

	export let data: {
		weeklyData?: {
			week: number;
			season: number;
			summary: {
				overallSummary: string;
				matchupSummaries: {
					team1: string;
					team2: string;
					summary: string;
					matchupId: number;
				}[];
			};
			highestScoringPlayer: {
				player: string;
				owner: string;
				score: number;
			};
			highestScoringTeam: {
				owner: string;
				score: number;
			};
			matchups: {
				matchupId: number;
				teamName: string;
				totalPoints: number;
				result: 'Win' | 'Loss';
			}[];
			standings: {
				[key: string]: string | number;
			}[];
		};
		availableWeeks?: WeekEntry[];
		error?: string;
	};

	const { weeklyData, error, availableWeeks = [] } = data;

	// Group available weeks by season for display
	const seasons = availableWeeks.reduce(
		(acc, entry) => {
			if (!acc[entry.season]) acc[entry.season] = [];
			acc[entry.season].push(entry.week);
			return acc;
		},
		{} as Record<number, number[]>
	);

	const sortedSeasons = Object.keys(seasons)
		.map(Number)
		.sort((a, b) => b - a);

	function onWeekChange(event: Event) {
		const val = (event.target as HTMLSelectElement).value;
		if (!val) return;
		const [season, week] = val.split('-');
		goto(`?season=${season}&week=${week}`);
	}

	function currentValue() {
		if (!weeklyData) return '';
		return `${weeklyData.season}-${weeklyData.week}`;
	}
</script>

{#if error}
	<div
		class="bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded relative"
		role="alert"
	>
		<strong class="font-bold">Error:</strong>
		<span class="block sm:inline">{error}</span>
	</div>
{:else if weeklyData}
	<div class="container mx-auto px-4 py-8 bg-gray-900 text-gray-100">
		<div class="flex items-center justify-between mb-6 flex-wrap gap-4">
			<h1 class="text-4xl font-bold">
				{weeklyData.season} · Week {weeklyData.week} Fantasy Football Summary
			</h1>
			{#if availableWeeks.length > 1}
				<div class="flex items-center gap-2">
					<label for="week-select" class="text-gray-400 text-sm">View week:</label>
					<select
						id="week-select"
						class="bg-gray-800 text-gray-100 border border-gray-600 rounded px-3 py-1.5 text-sm cursor-pointer"
						value={currentValue()}
						on:change={onWeekChange}
					>
						{#each sortedSeasons as season}
							<optgroup label={String(season)}>
								{#each seasons[season] as week}
									<option value={`${season}-${week}`}>{season} · Week {week}</option>
								{/each}
							</optgroup>
						{/each}
					</select>
				</div>
			{/if}
		</div>

		<div class="bg-gray-800 shadow-md rounded px-8 pt-6 pb-8 mb-4">
			<h2 class="text-2xl font-semibold mb-4">Weekly Summary</h2>
			<p class="text-gray-300 text-base">{weeklyData.summary.overallSummary}</p>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
			<div class="bg-blue-900 rounded-lg p-4">
				<h3 class="text-xl font-semibold mb-2">Highest Scoring Player</h3>
				<p class="text-blue-300">
					{weeklyData.highestScoringPlayer.player} ({weeklyData.highestScoringPlayer.owner}):
					<span class="font-bold">{weeklyData.highestScoringPlayer.score.toFixed(2)} points</span>
				</p>
			</div>
		</div>

		<div class="mb-8">
			<h2 class="text-2xl font-semibold mb-4">Matchups</h2>
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
				{#each weeklyData.summary.matchupSummaries as matchup}
					<div class="bg-gray-800 shadow-md rounded-lg p-4">
						<h3 class="text-lg font-semibold mb-2">{matchup.team1} vs {matchup.team2}</h3>
						<p class="text-gray-300 mb-2">{matchup.summary}</p>
						{#each weeklyData.matchups.filter((m) => m.matchupId === matchup.matchupId) as team}
							<p class="text-sm">
								{team.teamName}: {team.totalPoints.toFixed(2)} points
								<span class={team.result === 'Win' ? 'text-green-400' : 'text-red-400'}>
									({team.result})
								</span>
							</p>
						{/each}
					</div>
				{/each}
			</div>
		</div>

		<div class="mb-8">
			<h2 class="text-2xl font-semibold mb-4">Standings</h2>
			<div class="overflow-x-auto">
				<table class="min-w-full bg-gray-800">
					<thead class="bg-gray-700 text-gray-100">
						<tr>
							{#each Object.keys(weeklyData.standings[0]) as header}
								<th class="text-left py-3 px-4 uppercase font-semibold text-sm">{header}</th>
							{/each}
						</tr>
					</thead>
					<tbody class="text-gray-300">
						{#each weeklyData.standings as team, i}
							<tr class={i % 2 === 0 ? 'bg-gray-700' : 'bg-gray-800'}>
								{#each Object.values(team) as value}
									<td class="text-left py-3 px-4">
										{typeof value === 'number' ? value.toFixed(2) : value}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
{:else}
	<div class="flex justify-center items-center h-screen">
		<div class="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-100"></div>
	</div>
{/if}
