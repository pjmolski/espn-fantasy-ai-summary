<script lang="ts">
	import '../app.css';
	import { inject } from '@vercel/analytics';
	inject();

	let menuOpen = false;
	function closeMenu() { menuOpen = false; }
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@100;200;300;400;600;700&display=swap" rel="stylesheet" />
</svelte:head>

<div class="nav-wrapper">
	<button class="hamburger" onclick={() => menuOpen = !menuOpen} aria-label="Menu">☰</button>
	{#if menuOpen}
		<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
		<div class="nav-backdrop" onclick={closeMenu}></div>
		<nav class="nav-menu">
			<a href="/" class="nav-link" onclick={closeMenu}>📅 Week Recap</a>
			<a href="/history" class="nav-link" onclick={closeMenu}>📜 League History</a>
		</nav>
	{/if}
</div>

<slot />

<style>
	:global(*) { box-sizing: border-box; }
	.nav-wrapper { position: fixed; top: 10px; right: 12px; z-index: 1000; }
	.hamburger {
		background: #1e1e1e;
		border: 1px solid rgba(255,255,255,0.15);
		color: rgba(255,255,255,0.7);
		font-size: 16px;
		padding: 5px 11px;
		cursor: pointer;
		border-radius: 4px;
		font-family: inherit;
		line-height: 1;
	}
	.hamburger:hover { background: #272727; color: #fff; }
	.nav-backdrop { position: fixed; inset: 0; z-index: -1; }
	.nav-menu {
		position: absolute; top: calc(100% + 6px); right: 0;
		background: #1e1e1e;
		border: 1px solid rgba(255,255,255,0.12);
		border-radius: 4px;
		min-width: 170px;
		display: flex; flex-direction: column;
		overflow: hidden;
		box-shadow: 0 8px 24px rgba(0,0,0,0.4);
	}
	.nav-link {
		padding: 11px 16px;
		color: rgba(255,255,255,0.8);
		text-decoration: none;
		font-size: 13px;
		font-family: 'Raleway', sans-serif;
		font-weight: 600;
		letter-spacing: 0.3px;
	}
	.nav-link:hover { background: rgba(255,255,255,0.07); color: #fff; }
</style>
