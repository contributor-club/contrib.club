<script lang="ts">
	const backHref = '/';
	let isNavigating = false;

	function handleBackClick(event: MouseEvent) {
		event.preventDefault();
		isNavigating = true;
		setTimeout(() => {
			window.location.href = backHref;
		}, 10);
	}
</script>

<svelte:head>
	<title>Privacy Policy — Contrib.Club</title>
	<meta name="description" content="Privacy policy for Contrib.Club." />
</svelte:head>

<div class="min-h-screen bg-[#f7f7f2] text-slate-900">
	<div
		class={`pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-6 transition-opacity duration-200 ${
			isNavigating ? 'opacity-100' : 'opacity-0'
		}`}
		aria-hidden={!isNavigating}
	>
		<div
			class="flex max-w-sm flex-col items-center gap-3 rounded-lg border-2 border-slate-900 bg-white px-6 py-5 text-center text-slate-900 shadow-[10px_10px_0_#0f172a]"
		>
			<div class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
				<span class="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-l-slate-900"></span>
				Loading...
			</div>
			<p class="text-base font-semibold">Opening the next page</p>
			<p class="text-xs text-slate-600">Hang tight while we redirect you.</p>
		</div>
	</div>
	<main class="mx-auto max-w-5xl px-5 py-12 space-y-10">
		<a
			class="inline-flex items-center gap-2 rounded-md border-2 border-slate-900 bg-white px-3 py-2 text-sm font-semibold shadow-[4px_4px_0_#0f172a] transition hover:-translate-y-[1px]"
			href={backHref}
			onclick={handleBackClick}
		>
			<span class="text-lg">←</span> Back to Contrib.Club
		</a>

		<section
			class="space-y-4 rounded-lg border-2 border-slate-900 bg-white p-6 shadow-[10px_10px_0_#0f172a]"
		>
			<p class="text-xs font-semibold uppercase tracking-wide text-slate-600">Privacy</p>
			<h1 class="text-3xl font-semibold">Privacy Policy</h1>
			<p class="text-slate-700">
				We keep data collection lean. This page explains what we collect, why, and how you can reach us
				with questions.
			</p>
		</section>

		<section class="grid gap-5 lg:grid-cols-2">
			<article class="brut-card">
				<h2 class="brut-title">What we collect (application form)</h2>
				<ul class="brut-list">
					<li>Your name and email so we can contact you about contributions.</li>
					<li>Your GitHub handle; we verify it via GitHub&apos;s public API.</li>
					<li>Basic request metadata (time of submission, request/response logs) for troubleshooting.</li>
				</ul>
			</article>

			<article class="brut-card">
				<h2 class="brut-title">What we collect (blog reactions)</h2>
				<ul class="brut-list">
					<li>Your emoji choice for a post.</li>
					<li>We store minimal identifiers to prevent duplicate reactions (e.g., hashed client info); no profiles are built.</li>
					<li>Aggregate counts are public; individual identifiers are not.</li>
				</ul>
			</article>

			<article class="brut-card">
				<h2 class="brut-title">How we use it</h2>
				<ul class="brut-list">
					<li>To review applications and invite contributors.</li>
					<li>To keep reaction totals accurate and prevent abuse.</li>
					<li>To debug errors and improve the site.</li>
				</ul>
			</article>

			<article class="brut-card">
				<h2 class="brut-title">How long we keep it</h2>
				<ul class="brut-list">
					<li>Application data is retained while we review and maintain contributor records.</li>
					<li>Reaction data is retained as long as the post exists or until we reset counts.</li>
					<li>Logs are rotated on a regular basis.</li>
				</ul>
			</article>

			<article class="brut-card">
				<h2 class="brut-title">Your choices</h2>
				<ul class="brut-list">
					<li>Do not submit the application form if you do not want to share contact details.</li>
					<li>Reactions are optional; you can close the page to avoid sending one.</li>
					<li>Request removal: email us and include your GitHub handle and the data you want removed.</li>
				</ul>
			</article>

			<article class="brut-card">
				<h2 class="brut-title">Contact</h2>
				<ul class="brut-list">
					<li>Email: <a class="brut-link" href="mailto:team@contrib.club">team@contrib.club</a></li>
					<li>GitHub: <a class="brut-link" href="https://github.com/contributor-club/contrib.club" target="_blank" rel="noreferrer">contributor-club/contrib.club</a></li>
				</ul>
			</article>
		</section>
	</main>
</div>

<style>
	.brut-card {
		border: 2px solid #0f172a;
		background: white;
		padding: 1.5rem;
		border-radius: 0.75rem;
		box-shadow: 8px 8px 0 #0f172a;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.brut-title {
		font-size: 1.1rem;
		font-weight: 700;
	}

	.brut-list {
		list-style: disc;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		color: #1f2937;
	}

	.brut-link {
		text-decoration: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: 4px;
		color: #0f172a;
		font-weight: 600;
	}
</style>
