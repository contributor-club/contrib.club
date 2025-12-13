<script lang="ts">
	let { error, status } = $props();
</script>

<svelte:head>
	<title>{status} — Contrib.Club</title>
</svelte:head>

<div class="min-h-screen bg-[#f7f7f2] text-slate-900">
	<main class="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-5 py-12">
		<section class="space-y-4 rounded-lg border-2 border-slate-900 bg-white p-6 shadow-[8px_8px_0_#0f172a]">
			<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Error {status}</p>
			<h1 class="text-4xl font-semibold">Something went off-script.</h1>
			<p class="text-slate-700">{error?.message ?? 'Page not found.'}</p>
			<div class="flex flex-wrap gap-3 text-sm">
				<a
					class="rounded-md border-2 border-slate-900 bg-white px-4 py-2 font-semibold text-slate-900 shadow-[4px_4px_0_#0f172a] transition hover:-translate-y-[2px]"
					href="/"
				>
					Back home
				</a>
				<a
					class="rounded-md border-2 border-slate-900 bg-white px-4 py-2 font-semibold text-slate-900 shadow-[4px_4px_0_#0f172a] transition hover:-translate-y-[2px]"
					href="mailto:hello@contrib.club"
				>
					Contact support
				</a>
			</div>
		</section>
	</main>
</div>
