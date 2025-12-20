<!--
                                                                     
                                                                     
	▄█████  ▄▄▄  ▄▄  ▄▄ ▄▄▄▄▄▄ ▄▄▄▄  ▄▄ ▄▄▄▄    ▄█████ ▄▄    ▄▄ ▄▄ ▄▄▄▄  
	██     ██▀██ ███▄██   ██   ██▄█▄ ██ ██▄██   ██     ██    ██ ██ ██▄██ 
	▀█████ ▀███▀ ██ ▀██   ██   ██ ██ ██ ██▄█▀ ▄ ▀█████ ██▄▄▄ ▀███▀ ██▄█▀ 
                                                                     
	 Contrib.Club — designed and developed by the Contributor Club team

	 
-->
<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<script src="https://databucket.online/v1/analytics/2.js"></script>
	<link rel="icon" href={favicon} /></svelte:head>
{@render children()}
