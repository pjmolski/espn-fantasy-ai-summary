<script>
	import '../app.css';
	import { inject } from '@vercel/analytics';
	inject();
</script>

<svelte:head>
	<!-- Google Analytics -->
	<script async src="https://www.googletagmanager.com/gtag/js?id=G-45H05PFT8J"></script>
	<script>
		window.dataLayer = window.dataLayer || [];
		function gtag(){dataLayer.push(arguments);}
		gtag('js', new Date());
		gtag('config', 'G-45H05PFT8J');
	</script>
</svelte:head>

<slot />
