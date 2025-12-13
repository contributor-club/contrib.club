<script lang="ts">
	import { onMount } from 'svelte';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';

	type BlogEntry = {
		slug: string;
		title: string;
		description: string;
		content: string;
		author: string;
		authorUrl?: string | null;
		createdAt: string;
		modifiedAt: string;
		reactions: Record<string, number>;
	};

	const renderer = new marked.Renderer();
	const sluggerCtor = (marked as any).Slugger;
	const globalSlugger =
		typeof sluggerCtor === 'function'
			? new sluggerCtor()
			: { slug: (val: string) => val?.toString().toLowerCase().replace(/\s+/g, '-') ?? '' };
	renderer.heading = (text: string, level: number, raw: string, maybeSlugger?: { slug: (value: string) => string }) => {
		const slugger = maybeSlugger ?? globalSlugger;
		const slug = slugger.slug(raw || text || '');
		return `<h${level} id="${slug}" class="md-heading"><button type="button" class="anchor-hash" data-anchor="${slug}" aria-label="Copy link to ${text}">#</button>${text}</h${level}>`;
	};

	marked.setOptions(
		{
			gfm: true,
			breaks: true,
			headerIds: true,
			mangle: false,
			renderer
		} as any
	);

	let { data } = $props();
	const blog = $derived(data.blog as BlogEntry);
	const emojiOptions = ['👍', '🔥', '🚀', '💡', '❤️'];
	let reactionCounts: Record<string, number> = $state({});
	let userReaction: string | null = $state(null);
	let reactionError: string | null = $state(null);
	let reactionSubmitting = $state(false);
	let rateLimited = $state(false);

	const markdownHtml = $derived.by(() => {
		const raw = blog.content || '';
		const normalized = raw
			.replace(/\r\n/g, '\n')
			.replace(/\\dn/g, '\n\n')
			.replace(/\\n/g, '\n');
		return DOMPurify.sanitize(marked.parse(normalized) as string, { USE_PROFILES: { html: true } });
	});

	function formatDate(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return 'Recent';
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	const isNew = $derived(Date.now() - new Date(blog.createdAt).getTime() < 1000 * 60 * 60 * 24 * 3);
	const avatar = $derived(`https://github.com/${blog.author}.png?size=120`);
	const authorGithub = $derived(`https://github.com/${blog.author}`);
	const authorWebsite = $derived.by(() => {
		const url = blog.authorUrl?.trim();
		if (!url) return null;
		if (/^https?:\/\//i.test(url)) return url;
		return `https://${url.replace(/^\/+/, '')}`;
	});

	onMount(() => {
		void hydrateUserReaction();
	});

	$effect(() => {
		reactionCounts = { ...(blog.reactions ?? {}) };
	});

	async function hydrateUserReaction() {
		try {
			const res = await fetch(`/api/blogs/${blog.slug}/reaction`);
			if (!res.ok) return;
			const payload = await res.json();
			reactionCounts = payload.counts ?? reactionCounts;
			userReaction = payload.userReaction ?? userReaction;
		} catch {
			/* ignore */
		}
	}

	function handleAnchorClick(event: MouseEvent | KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const button = target?.closest<HTMLButtonElement>('.anchor-hash');
		if (!button) return;
		if (event instanceof KeyboardEvent) {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			if (event.key === ' ') event.preventDefault();
		}
		const anchor = button.dataset.anchor;
		if (!anchor) return;
		const url = `${window.location.origin}${window.location.pathname}#${anchor}`;
		window.location.hash = anchor;
		navigator.clipboard?.writeText(url).catch(() => {});
	}

	async function react(emoji: string) {
		if (reactionSubmitting) return;
		reactionError = null;
		rateLimited = false;
		reactionSubmitting = true;
		try {
			const res = await fetch(`/api/blogs/${blog.slug}/reaction`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ emoji })
			});
			if (!res.ok) {
				if (res.status === 429) {
					const payload = await res.json().catch(() => ({}));
					rateLimited = true;
					userReaction = payload.userReaction ?? userReaction;
					reactionCounts = payload.counts ?? reactionCounts;
					return;
				}
				const msg = (await res.text()) || 'Could not save reaction';
				reactionError = msg;
				return;
			}
			const payload = await res.json();
			reactionCounts = payload.counts ?? reactionCounts;
			userReaction = payload.userReaction ?? null;
		} catch (error) {
			reactionError = 'Could not save reaction';
		} finally {
			reactionSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>{blog.title} — Contrib.Club Blog</title>
	<meta name="description" content={blog.description} />
</svelte:head>

<div class="min-h-screen bg-[#f7f7f2] text-slate-900">
	<main class="mx-auto max-w-4xl px-5 py-10">
		<a
			class="inline-flex items-center gap-2 rounded-md border-2 border-slate-900 bg-white px-3 py-2 text-sm font-semibold shadow-[4px_4px_0_#0f172a] transition hover:-translate-y-[1px]"
			href="https://contrib.club/"
		>
			<span class="text-lg">←</span> Back to Contrib.Club
		</a>

		<article class="mt-6 space-y-6 rounded-lg border-2 border-slate-900 bg-white p-6 shadow-[8px_8px_0_#0f172a]">
			<div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div class="space-y-2">
					<p class="text-xs font-semibold uppercase tracking-wide text-slate-600">
						{isNew ? '(NEW)' : formatDate(blog.createdAt)}
					</p>
					<h1 class="text-3xl font-semibold md:text-4xl">{blog.title}</h1>
					<p class="text-slate-700">{blog.description}</p>
					<p class="text-xs font-semibold text-slate-500">
						Updated {formatDate(blog.modifiedAt)}
					</p>
				</div>
				<div class="flex flex-col items-start gap-3 rounded-md border-2 border-slate-900 bg-slate-50 px-3 py-2 shadow-[4px_4px_0_#0f172a]">
					<div class="flex items-center gap-3">
						<img
							alt={blog.author}
							class="h-12 w-12 rounded-md border border-slate-200 object-cover"
							src={avatar}
							loading="lazy"
						/>
						<div>
							<p class="text-sm font-semibold">@{blog.author}</p>
							<p class="text-xs text-slate-600">Author</p>
						</div>
					</div>
					<div class="flex flex-wrap gap-2">
						<a
							class="inline-flex items-center gap-2 rounded-md border-2 border-slate-900 bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-[3px_3px_0_#0f172a] transition hover:-translate-y-[1px]"
							href={authorGithub}
							target="_blank"
							rel="noreferrer"
						>
							<svg viewBox="0 0 16 16" class="h-4 w-4 fill-current">
								<path
									fill-rule="evenodd"
									d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
								/>
							</svg>
							GitHub
						</a>
						{#if authorWebsite}
							<a
								class="inline-flex items-center gap-2 rounded-md border-2 border-slate-900 bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-[3px_3px_0_#0f172a] transition hover:-translate-y-[1px]"
								href={authorWebsite}
								target="_blank"
								rel="noreferrer"
							>
								<svg viewBox="0 0 20 20" class="h-4 w-4 fill-current">
									<path
										d="M10 1.667a8.333 8.333 0 1 0 0 16.666 8.333 8.333 0 0 0 0-16.666Zm-6.667 8.333c0-.725.117-1.422.333-2.075l2.509 6.875A6.67 6.67 0 0 1 3.333 10Zm6.667 6.667c-.558 0-1.098-.08-1.608-.229l1.708-4.966 1.748 4.788a6.63 6.63 0 0 1-1.848.407Zm.833-5.705 2.014-3.7.791 3.7h-2.805Zm-1.666 0h-2.9l.844-3.452 2.056 3.452Zm0-2.95-2.275-3.817a6.667 6.667 0 0 1 3.108-.263l-.833 4.08Zm1.666 0 .833-4.076a6.67 6.67 0 0 1 2.88 1.24l-3.713 2.836Zm3.933-1.348A6.69 6.69 0 0 1 16.667 10c0 1.574-.534 3.026-1.428 4.19l-1.806-5.795h2.998Z"
									/>
								</svg>
								Website
							</a>
						{/if}
					</div>
				</div>
				</div>

				<div class="pt-10 markdown-body prose prose-slate max-w-none text-slate-800 prose-img:rounded-md prose-img:border prose-img:border-slate-200 prose-img:shadow-[3px_3px_0_#0f172a]">
					{@html markdownHtml}
				</div>

			<style>
				.md-heading {
					display: flex;
					align-items: center;
					gap: 8px;
					padding-bottom: 6px;
					border-bottom: 2px solid #0f172a;
					position: relative;
					padding-left: 24px;
					margin-bottom: 12px;
				}
				.anchor-btn {
					display: none;
				}
				.markdown-body {
					white-space: pre-wrap;
				}
				.anchor-hash {
					position: absolute;
					left: -8px;
					color: #94a3b8;
					font-size: 24px;
					font-weight: 700;
					background: transparent;
					border: none;
					cursor: pointer;
					padding: 0 6px 0 0;
				}
				.pressing {
					transform: translateY(2px);
					box-shadow: 1px 1px 0 #0f172a;
				}
				.markdown-body h1 { font-size: 2.25rem; line-height: 2.5rem; }
				.markdown-body h2 { font-size: 1.8rem; line-height: 2.2rem; }
				.markdown-body h3 { font-size: 1.5rem; line-height: 2rem; }
				.markdown-body h4 { font-size: 1.25rem; line-height: 1.75rem; }
				.markdown-body h5 { font-size: 1.1rem; line-height: 1.5rem; }
				.markdown-body h6 { font-size: 1rem; line-height: 1.4rem; }
			</style>

			<div class="rounded-md border-2 border-slate-900 bg-slate-50 p-3 shadow-[4px_4px_0_#0f172a]">
				<div class="flex items-center justify-between">
					<p class="text-xs font-semibold uppercase tracking-wide text-slate-600">Reactions</p>
					{#if reactionError}
						<p class="text-xs font-semibold text-rose-600">{reactionError}</p>
					{/if}
				</div>
					<div class="mt-2 flex flex-wrap gap-2">
						{#each emojiOptions as emoji}
							<button
								class={`inline-flex items-center gap-2 rounded-full border-2 border-slate-900 px-3 py-1 text-sm font-semibold shadow-[3px_3px_0_#0f172a] transition ${
									userReaction === emoji ? 'bg-slate-900 text-white' : 'bg-white text-slate-800 hover:-translate-y-[1px]'
								} ${reactionSubmitting ? 'opacity-80' : ''}`}
								disabled={reactionSubmitting}
								onclick={() => react(emoji)}
								onmousedown={(event) => event.currentTarget.classList.add('pressing')}
								onmouseup={(event) => event.currentTarget.classList.remove('pressing')}
								onmouseleave={(event) => event.currentTarget.classList.remove('pressing')}
							>
								<span>{emoji}</span>
								<span class={`text-xs font-bold ${userReaction === emoji ? 'text-white' : 'text-slate-800'}`}>
									{reactionCounts[emoji] ?? 0}
								</span>
						</button>
					{/each}
				</div>
				{#if rateLimited}
					<div class="mt-3 rounded-md border-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 shadow-[3px_3px_0_#0f172a]">
						You are rate limited. Please wait a few seconds before reacting again.
					</div>
				{/if}
			</div>
		</article>
	</main>
</div>

<svelte:window on:click={handleAnchorClick} on:keydown={handleAnchorClick} />
