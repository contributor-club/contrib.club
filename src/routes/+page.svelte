<!--
                                                                     
                                                                     
	▄█████  ▄▄▄  ▄▄  ▄▄ ▄▄▄▄▄▄ ▄▄▄▄  ▄▄ ▄▄▄▄    ▄█████ ▄▄    ▄▄ ▄▄ ▄▄▄▄  
	██     ██▀██ ███▄██   ██   ██▄█▄ ██ ██▄██   ██     ██    ██ ██ ██▄██ 
	▀█████ ▀███▀ ██ ▀██   ██   ██ ██ ██ ██▄█▀ ▄ ▀█████ ██▄▄▄ ▀███▀ ██▄█▀ 
                                                                     
	 Contrib.Club — designed and developed by the Contributor Club team

	 
-->

<script lang="ts">
	import { onMount } from 'svelte';

	type OwnerFilter = 'all' | 'group' | 'personal';
	type Project = {
		title: string;
		summary: string;
		tags: string[];
		isNew?: boolean;
		ownerType: OwnerFilter;
		owner: string;
		status: string;
		github: string;
		contributors: { name: string; avatar: string }[];
		hearts: number;
		sparklinePath: string;
	};

	// Server-provided GitHub stats (org + repo-level)
	let { data } = $props();

	function formatNumber(value: number) {
		if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
		if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
		return value.toString();
	}

	const githubStats = $derived(data?.githubStats ?? { stars: 0, forks: 0, contributors: 0 });

	const repoStats: Record<string, { stars: number; forks: number; activity?: number[] }> = $derived(
		data?.repoStats ?? {}
	);
	const statsReady = $derived(Boolean(data?.repoStats));
	const orgMembersCount = $derived((data?.orgMembers ?? []).length);
	const orgReposCount = $derived((data?.orgRepos ?? []).length);
	const memberRepos = $derived(data?.memberRepos ?? []);
	const memberDetails = $derived(data?.memberDetails ?? []);

	// Hero stat blocks derived from live GitHub data
	const stats = $derived([
		{ label: 'Stars', value: formatNumber(githubStats.stars), hint: 'Org-wide GitHub stars' },
		{ label: 'Forks', value: formatNumber(githubStats.forks), hint: 'Org-wide forks' },
		{ label: 'Members', value: formatNumber(githubStats.contributors), hint: 'GitHub org members' }
	]);

	// Team member profiles from org data
	const memberProfiles = $derived(
		(memberDetails.length > 0 ? memberDetails : (data?.orgMembers ?? [])).map((member) => ({
			name: 'name' in member ? (member as any).name ?? member.login : member.login,
			handle: member.login,
			avatar: `${member.avatar_url}&size=120`,
			github: member.html_url,
			public_repos: (member as any).public_repos,
			public_gists: (member as any).public_gists,
			followers: (member as any).followers,
			star_count: (member as any).star_count
		}))
	);

	// Typing animation languages
	const greetings = ['Hello', 'Bonjour', 'Hola', 'Ciao', 'Hallo', 'Hej'];
	let greetingIndex = $state(0);
	let typingText = $state('');
	let charIndex = $state(0);
	let deleting = $state(false);
	let pauseTicks = $state(0);

	type BlogPost = { title: string; date?: string; excerpt: string; url: string; tags?: string[]; content?: string };

	let applyName = $state('');
	let applyEmail = $state('');
	let applyGithubUser = $state('');
	let githubStatus = $state<{ state: 'idle' | 'loading' | 'valid' | 'invalid'; avatar?: string; name?: string }>({
		state: 'idle'
	});
	let formError = $state<string | null>(null);
	let formSuccess = $state<string | null>(null);
	let formLoading = $state(false);
	const orgRepos = $derived(data?.orgRepos ?? []);
	const orgProjects = $derived(
		orgRepos.map((repo) => ({
			title: repo.name,
			summary: repo.description ?? 'Open-source repository in the contributor-club org.',
			tags: ['Org Repo'],
			isNew: false,
			ownerType: 'group' as const,
			owner: 'contributor-club',
			status: 'Live',
			github: repo.html_url,
			updated_at: repo.updated_at,
			created_at: repo.created_at,
			contributors: [],
			hearts: 0,
			sparklinePath: 'M2 28 Q 20 22 38 24 T 74 18 T 110 26 T 146 12'
		}))
	);

	const fallbackBlogPosts: BlogPost[] = [
		{
			title: 'Neo-brutal Marketing',
			date: 'Recent',
			tags: ['Design', 'Frontend'],
			excerpt: 'How we built a unique brand and site experience with neo-brutalism principles...',
			url: 'https://github.com/contributor-club/contrib.club/wiki'
		}
	];

	const blogPosts = $derived(
		((data?.blogPosts as BlogPost[] | undefined) ?? []).map((post) => ({
			title: post.title,
			date: post.date ?? 'Recent',
			excerpt: summaryWithEllipsis(post.excerpt),
			content: post.content ?? '',
			url: post.url,
			tags: post.tags ?? []
		}))
	);

	const renderedBlogPosts = $derived(blogPosts.length ? blogPosts : fallbackBlogPosts);

	// Normalizes GitHub input to a username
	function sanitizeGithubUser(value: string): string | null {
		const cleaned = value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/^@/, '');
		if (!cleaned) return null;
		const username = cleaned.split('/')[0];
		return username.length ? username : null;
	}

	// Validate GitHub account via public API
	async function validateGithub() {
		const username = sanitizeGithubUser(applyGithubUser);
		if (!username) {
			githubStatus = { state: 'invalid' };
			return;
		}
		githubStatus = { state: 'loading' };
		try {
			const res = await fetch(`https://api.github.com/users/${username}`);
			if (!res.ok) {
				githubStatus = { state: 'invalid' };
				return;
			}
			const payload = await res.json();
			githubStatus = {
				state: 'valid',
				avatar: payload.avatar_url,
				name: payload.name || payload.login
			};
		} catch {
			githubStatus = { state: 'invalid' };
		}
	}

	// Reset GitHub validation state
	function resetGithubValidation() {
		githubStatus = { state: 'idle' };
	}

	// Handle application submit with basic field validation and fake async
	async function submitApplication(event: Event) {
		event.preventDefault();
		formError = null;
		formSuccess = null;

		if (!applyName.trim() || !applyEmail.trim() || githubStatus.state !== 'valid') {
			formError = 'Name, email, and a valid GitHub profile are required.';
			return;
		}

		formLoading = true;
		formSuccess = null;
		try {
			const res = await fetch('/api/contact', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: applyName,
					email: applyEmail,
					github: `https://github.com/${sanitizeGithubUser(applyGithubUser)}`
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				formError = data.error || 'Could not submit application.';
			} else {
				formSuccess = 'Application received. We will review and reach out.';
				applyName = '';
				applyEmail = '';
				applyGithubUser = '';
				githubStatus = { state: 'idle' };
			}
		} catch (error) {
			formError = 'Could not submit application.';
		} finally {
			formLoading = false;
		}
	}

	type OrgRepoShape = {
		name?: string;
		description?: string | null;
		html_url?: string;
		stargazers_count?: number;
		forks_count?: number;
		topics?: string[];
		language?: string | null;
		updated_at?: string;
		created_at?: string;
	};

	// Fallback repo if org fetch fails or returns empty
	const hiddenTopics = ['contrib-club', 'contrib.club'];

	function summaryWithEllipsis(text: string | null | undefined) {
		if (!text) return 'No description...';
		const trimmed = text.trim();
		if (trimmed.endsWith('...')) return trimmed;
		if (trimmed.endsWith('..')) return `${trimmed}.`;
		if (trimmed.endsWith('.')) return `${trimmed}..`;
		return `${trimmed}...`;
	}

	// Projects sourced from org repos; tags from topics or language, ignoring sentinel topic
	const allProjects = $derived(
		[...(orgRepos ?? []), ...(memberRepos ?? [])]
			.filter((repo) => {
				const topics = repo.topics ?? [];
				return !topics.includes('no.contrib.club') && !topics.includes('no-contrib-club');
			})
			.map((repo: OrgRepoShape) => ({
				title: repo.name ?? 'Repo',
				summary: repo.description ?? 'No description',
				tags: (() => {
					const topicTags = (repo.topics ?? []).filter((tag) => !hiddenTopics.includes(tag));
					return topicTags.length > 0 ? topicTags : [repo.language || 'General'];
				})(),
				created_at: repo.created_at,
				updated_at: repo.updated_at,
				isNew: repo.updated_at
					? Date.now() - new Date(repo.updated_at).getTime() < 1000 * 60 * 60 * 24 * 45
					: false,
				ownerType: 'group' as const,
				owner: 'contributor-club',
				status: 'Live',
				github: repo.html_url ?? 'https://github.com/contributor-club',
				contributors: [],
				hearts: 0,
				sparklinePath: 'M2 28 Q 20 22 38 24 T 74 18 T 110 26 T 146 12'
			}))
	);

	const hasProjects = $derived(allProjects.length > 0);

	const tagOptions = $derived(
		Array.from(
			new Set(
				allProjects
					.flatMap((project) => project.tags)
					.filter((tag) => !hiddenTopics.includes(tag))
			)
		)
	);

	const tagPalette = [
		'bg-rose-100 text-rose-900 border-rose-200',
		'bg-orange-100 text-orange-900 border-orange-200',
		'bg-amber-100 text-amber-900 border-amber-200',
		'bg-lime-100 text-lime-900 border-lime-200',
		'bg-emerald-100 text-emerald-900 border-emerald-200',
		'bg-cyan-100 text-cyan-900 border-cyan-200',
		'bg-sky-100 text-sky-900 border-sky-200',
		'bg-indigo-100 text-indigo-900 border-indigo-200',
		'bg-fuchsia-100 text-fuchsia-900 border-fuchsia-200'
	];

	function pastelClass(tag: string) {
		let hash = 0;
		for (const char of tag) {
			hash = (hash + char.charCodeAt(0)) % tagPalette.length;
		}
		return tagPalette[hash];
	}

	const DAYS_IN_WINDOW = 60; // last 2 months (approx)

	// Generates a contribution heatmap; prefers real activity, falls back to a deterministic pattern
	function contributionBlocks(seed: string, activity?: number[]) {
		if (activity && activity.length > 0) {
			const lastWindow = activity.slice(-DAYS_IN_WINDOW);
			const maxValue = Math.max(...lastWindow, 0);
			return lastWindow.map((count) => {
				if (!maxValue) return count > 0 ? 1 : 0;
				const ratio = count / maxValue;
				if (count === 0) return 0;
				if (ratio > 0.66) return 3;
				if (ratio > 0.33) return 2;
				return 1;
			});
		}

		// Fallback to empty/neutral contributions when activity isn't available yet
		return Array.from({ length: DAYS_IN_WINDOW }, () => 0);
	}

	onMount(() => {
		const id = setInterval(() => {
			const current = greetings[greetingIndex];
			if (pauseTicks > 0) {
				pauseTicks -= 1;
				return;
			}
			if (!deleting) {
				// typing forward
				charIndex = Math.min(charIndex + 1, current.length);
				typingText = current.slice(0, charIndex);
				if (charIndex === current.length) {
					deleting = true;
					pauseTicks = 8;
				}
			} else {
				// deleting
				charIndex = Math.max(charIndex - 1, 0);
				typingText = current.slice(0, charIndex);
				if (charIndex === 0) {
					deleting = false;
					greetingIndex = (greetingIndex + 1) % greetings.length;
					pauseTicks = 4;
				}
			}
		}, 140);

		return () => clearInterval(id);
	});

	let selectedTags: string[] = $state([]);
	let ownerFilter: OwnerFilter = $state('all');
	let searchTerm = $state('');
	let visibleCount = $state(6);

	function toggleTag(tag: string) {
		selectedTags = selectedTags.includes(tag)
			? selectedTags.filter((value) => value !== tag)
			: [...selectedTags, tag];
	}

	function clearTags() {
		selectedTags = [];
	}

	function setOwner(filter: OwnerFilter) {
		ownerFilter = filter;
	}

	type FilterTab = 'all' | 'popular' | 'new';
	let activeFilter: FilterTab = $state('all');

	let filteredProjects: Project[] = $state([]);
	const filteredWithSearch = $derived(
		filteredProjects.filter((project) => {
			if (!searchTerm.trim()) return true;
			const term = searchTerm.toLowerCase();
			return (
				project.title.toLowerCase().includes(term) ||
				project.summary.toLowerCase().includes(term)
			);
		})
	);
	const visibleProjects = $derived(filteredWithSearch.slice(0, visibleCount));
	const showSearch = $derived(filteredProjects.length > 6 || allProjects.length > 6);

	$effect(() => {
		let list: Project[] = allProjects;

		if (activeFilter === 'new') {
			list = [...allProjects].sort((a, b) => {
				const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
				const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
				return bCreated - aCreated;
			});
		} else if (activeFilter === 'popular') {
			list = [...allProjects].sort((a, b) => {
				const aActivity = repoStats[a.github]?.activity ?? [];
				const bActivity = repoStats[b.github]?.activity ?? [];
				const aRecent = aActivity.slice(-DAYS_IN_WINDOW).reduce((sum, value) => sum + value, 0);
				const bRecent = bActivity.slice(-DAYS_IN_WINDOW).reduce((sum, value) => sum + value, 0);
				if (bRecent !== aRecent) return bRecent - aRecent;
				const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
				const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
				return bUpdated - aUpdated;
			});
		}

		if (selectedTags.length > 0) {
			list = list.filter((project) => selectedTags.every((tag) => project.tags.includes(tag)));
		}

		filteredProjects = list;
	});

	$effect(() => {
		// reset pagination when filters or search change
		filteredProjects;
		searchTerm;
		visibleCount = 6;
	});

	// Client-side logging of org data for quick diagnostics
	onMount(() => {
		console.log(
			`Contrib.Club data → members: ${orgMembersCount}, repos: ${orgReposCount}, projects rendered: ${allProjects.length}`
		);
	});

	// Log repositories and topics when loaded (client-side)
	$effect(() => {
		if (typeof window === 'undefined') return;
		const repos = [...(orgRepos ?? []), ...(memberRepos ?? [])];
		if (repos.length > 0) {
			console.log(
				'Contrib.Club repos with topics:',
				repos.map((repo) => ({
					name: repo.name,
					url: repo.html_url,
					topics: repo.topics ?? [],
					description: repo.description ?? 'No description'
				}))
			);
		}
	});
</script>

<svelte:head>
	<title>Contributor Club</title>
	<meta
		name="description"
		content="A club for all levels of open-source developers, from beginner projects to more advanced projects that require a group effort."
	/>
</svelte:head>

<div class="min-h-screen bg-[#f7f7f2] text-slate-900">
	<main class="mx-auto max-w-6xl px-5 pb-20 mt-10">
		<section class="flex min-h-[70vh] flex-col items-center gap-10 border-b-2 border-slate-900 py-16 text-center">

			<div class="mt-6 flex items-center justify-center gap-4">
				{#if memberProfiles.length === 0}
					<div class="h-16 w-16 rounded-md border-2 border-slate-900 bg-slate-100 shadow-[4px_4px_0_#0f172a] animate-pulse"></div>
				{:else}
					{#each memberProfiles as person}
						<div class="relative tooltip">
							<div
								class="h-16 w-16 rounded-md border-2 border-slate-900 bg-white shadow-[4px_4px_0_#0f172a]"
							>
								<img
									alt={person.name}
									class="h-full w-full rounded-[4px] object-cover"
									src={person.avatar}
									loading="lazy"
								/>
							</div>
							<div class="tooltip-bubble absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-md border-2 border-slate-900 bg-white p-3 text-left text-sm font-semibold text-slate-800 shadow-[5px_5px_0_#0f172a]">
								<div class="flex items-center justify-between">
									<span>{person.name}</span>
									<span class="text-xs text-slate-500">@{person.handle}</span>
								</div>
								<div class="mt-2 grid grid-cols-2 gap-1 text-xs">
									<span>⭐ {person.star_count ?? 0} stars</span>
									<span>📦 {person.public_repos ?? 0} repos</span>
									<span>👥 {person.followers ?? 0} followers</span>
									<span>✏️ {person.public_gists ?? 0} gists</span>
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<div class="space-y-4 mt-10">
				<h1 class="flex items-center justify-center gap-3 text-5xl font-semibold sm:text-6xl" data-test="hero-heading">
					<span>👋</span>
					<span class="whitespace-nowrap">{typingText}<span class="cursor">|</span></span>
				</h1>
				<p class="text-2xl font-semibold text-slate-900 sm:text-3xl" data-test="hero-subtitle">
					A club for open-source contributors.
				</p>
				<p class="text-lg text-slate-700" data-test="hero-description">
					A club for all levels of open-source developers, from beginner projects to more advanced projects that require a group effort.
				</p>
			</div>

			<style>
				.cursor {
					animation: blink 1s step-start infinite;
				}
				.tooltip .tooltip-bubble {
					opacity: 0;
					transform: translateY(4px);
					transition: opacity 120ms ease, transform 120ms ease;
				}
				.tooltip:hover .tooltip-bubble,
				.tooltip:focus-within .tooltip-bubble {
					opacity: 1;
					transform: translateY(0);
				}
				@keyframes blink {
					50% {
						opacity: 0;
					}
				}
			</style>
			<style>
				.project-summary {
					min-height: 3rem;
					line-height: 1.5rem;
					display: -webkit-box;
					-webkit-line-clamp: 2;
					-webkit-box-orient: vertical;
					overflow: hidden;
				}
			</style>

		<div class="mt-10 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
			{#if statsReady}
				{#each stats as stat}
						<div class="rounded-lg border-2 border-slate-900 bg-white p-5 text-left shadow-[6px_6px_0_#0f172a]" data-test={`stat-${stat.label.toLowerCase()}`}>
							<p class="text-xs font-semibold uppercase tracking-wide text-slate-600">{stat.label}</p>
							<p class="mt-2 text-2xl font-semibold" data-test="stat-value">{stat.value}</p>
							<p class="text-sm text-slate-600" data-test="stat-hint">{stat.hint}</p>
						</div>
					{/each}
				{:else}
					{#each Array(3) as _}
						<div class="h-24 rounded-lg border-2 border-slate-900 bg-slate-100 shadow-[6px_6px_0_#0f172a] animate-pulse"></div>
					{/each}
				{/if}
			</div>

			<a
				class="inline-flex items-center gap-2 rounded-md border-2 border-slate-900 bg-white px-4 py-2 text-sm font-semibold shadow-[4px_4px_0_#0f172a] transition hover:-translate-y-[1px]"
				href="#projects"
			>
				<span class="text-lg">↓</span> Scroll to view projects
			</a>
		</section>

		<section id="blog" class="space-y-5 border-t-2 border-slate-900 py-10">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Our Blog</p>
					<h2 class="text-3xl font-semibold">Notes from the team</h2>
					<p class="text-slate-700">Releases, projects, and practices brought to you by the Contrib.Club team.</p>
				</div>
			</div>
			<div class="grid gap-6 lg:grid-cols-3">
				{#each renderedBlogPosts as post}
					<article class="flex flex-col gap-3 rounded-lg border-2 border-slate-900 bg-white p-5 shadow-[6px_6px_0_#0f172a]">
						<div class="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-600">
							<span>{post.date ?? 'Recent'}</span>
							<div class="flex gap-2">
								{#each post.tags ?? [] as tag}
									<span class="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{tag}</span>
								{/each}
							</div>
						</div>
						<h3 class="text-xl font-semibold">{post.title}</h3>
						<p class="text-slate-700 whitespace-pre-line">
							{post.content ? summaryWithEllipsis(post.content) : post.excerpt}
						</p>
						{#if post.url}
							<a
								class="text-sm font-semibold underline decoration-2 decoration-slate-900 underline-offset-4"
								href={post.url}
								target="_blank"
								rel="noreferrer"
							>
								Read more ->
							</a>
						{:else}
							<span class="text-sm font-semibold text-slate-500">Read more coming soon</span>
						{/if}
					</article>
				{/each}
			</div>
		</section>

		<section id="projects" class="space-y-5 py-10">
			<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
				<div>
					<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">The Projects</p>
					<h2 class="text-3xl font-semibold">Our Projects & Services</h2>
					<p class="text-slate-700">
						<b>We're not slow.</b> We build and ship open-source projects that solve <i>real problems</i> for developers. <b>Fast!</b>
					</p>
				</div>
				<div class="flex items-center gap-2 rounded-md border-2 border-slate-900 bg-white p-1 shadow-[4px_4px_0_#0f172a]">
					{#each ['all', 'popular', 'new'] as filter}
						<button
							class={`relative tooltip rounded-full px-3 py-1 text-sm font-semibold ${
								activeFilter === filter ? 'bg-slate-900 text-white' : 'text-slate-800'
							}`}
							onclick={() => (activeFilter = filter as FilterTab)}
						>
							{filter === 'all' ? 'All' : filter === 'popular' ? 'Popular' : 'New'}
							{#if filter !== 'all'}
								<span class="tooltip-bubble absolute left-1/2 top-full z-10 mt-2 min-w-[160px] -translate-x-1/2 rounded-md border-2 border-slate-900 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-[4px_4px_0_#0f172a]">
									{filter === 'popular' ? 'Most changes made (last 60 days)' : 'Most recently created'}
								</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<div class="flex flex-wrap gap-2">
				{#each tagOptions as tag}
					<button
						class={`rounded-full border-2 border-slate-900 px-3 py-1 text-sm font-semibold shadow-[3px_3px_0_#0f172a] transition ${
							selectedTags.includes(tag)
								? 'bg-slate-900 text-white'
							: 'bg-white text-slate-800 hover:-translate-y-[1px]'
					}`}
					onclick={() => toggleTag(tag)}
				>
					{tag}
				</button>
			{/each}
				<button
					class="rounded-full border-2 border-slate-900 px-3 py-1 text-sm font-semibold text-slate-800 shadow-[3px_3px_0_#0f172a] transition hover:-translate-y-[1px]"
					onclick={clearTags}
				>
					Clear
				</button>
			</div>

			{#if showSearch}
				<div class="mt-3">
					<label class="sr-only" for="project-search">Search projects</label>
					<div class="flex items-center gap-2 rounded-lg border-2 border-slate-900 bg-white p-3 shadow-[4px_4px_0_#0f172a]">
						<svg viewBox="0 0 24 24" class="h-5 w-5 text-slate-700">
							<path
								fill="currentColor"
								d="M15.5 14h-.79l-.28-.27a6.471 6.471 0 0 0 1.57-4.23A6.5 6.5 0 1 0 9.5 16a6.471 6.471 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C8.01 14 6 11.99 6 9.5S8.01 5 10.5 5 15 7.01 15 9.5 12.99 14 10.5 14Z"
							/>
						</svg>
						<input
							id="project-search"
							class="w-full bg-transparent text-sm font-semibold text-slate-900 placeholder:text-slate-500 focus:outline-none"
							placeholder="Search projects"
							type="text"
							value={searchTerm}
							oninput={(event) => (searchTerm = event.currentTarget.value)}
						/>
					</div>
				</div>
			{/if}

			<div class="grid gap-5 lg:grid-cols-2">
				{#if !hasProjects}
					{#each Array(4) as _}
						<div class="h-44 rounded-lg border-2 border-slate-900 bg-slate-100 shadow-[6px_6px_0_#0f172a] animate-pulse"></div>
					{/each}
				{:else if filteredWithSearch.length === 0}
					<div class="rounded-lg border-2 border-slate-900 bg-white p-6 shadow-[6px_6px_0_#0f172a]">
						No projects match these tags yet. Try removing a filter.
					</div>
				{:else}
					{#each visibleProjects as project}
						<article class="flex flex-col gap-4 rounded-lg border-2 border-slate-900 bg-white p-6 shadow-[6px_6px_0_#0f172a] transition hover:-translate-y-[2px]" data-test="project-card">
							<div class="flex items-center justify-between">
								<div class="space-y-1">
									<h3 class="text-2xl font-semibold">{project.title}</h3>
									<p class="project-summary text-sm text-slate-700">{summaryWithEllipsis(project.summary)}</p>
								</div>
							</div>
							<div class="rounded-md border-2 border-slate-900 bg-slate-50 p-3 shadow-[4px_4px_0_#0f172a]">
								<p class="text-[11px] font-semibold uppercase text-slate-600">Contributions</p>
								<div class="mt-2 flex justify-center">
									<div class="grid min-h-[56px] grid-flow-col auto-cols-[16px] grid-rows-3 gap-1 pr-2">
										{#each contributionBlocks(project.title, repoStats[project.github]?.activity) as intensity}
											<div
												aria-label="Contribution block"
												class={`h-4 w-4 rounded-sm border border-slate-200 ${
													intensity === 0
														? 'bg-slate-200'
														: intensity === 1
															? 'bg-emerald-200'
															: intensity === 2
																? 'bg-emerald-400'
																: 'bg-emerald-600'
												}`}
												data-test="contrib-block"
											></div>
										{/each}
									</div>
								</div>
							</div>
							<div class="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
								<div class="flex h-full items-center justify-between rounded-md border-2 border-slate-900 bg-white px-3 py-2 shadow-[3px_3px_0_#0f172a]" data-test="project-stars">
									<span class="text-[11px] font-semibold uppercase text-slate-600">Stars</span>
									<span class="flex items-center gap-1 text-base font-semibold">
										<svg viewBox="0 0 24 24" class="h-4 w-4 fill-current text-rose-500">
											<path d="M12 21s-5.29-2.95-8.13-6.51C1.95 12.36 1 10.56 1 8.6 1 5.5 3.38 3 6.4 3 8.3 3 9.9 4 11 5.5 12.1 4 13.7 3 15.6 3 18.62 3 21 5.5 21 8.6c0 1.96-.95 3.76-2.87 5.89C17.29 18.05 12 21 12 21Z" />
										</svg>
										{(repoStats[project.github]?.stars ?? 0).toLocaleString()}
									</span>
								</div>
								{#if project.github}
									<a
										class="flex h-full items-center justify-between rounded-md border-2 border-slate-900 bg-white px-3 py-2 text-xs font-semibold shadow-[3px_3px_0_#0f172a] transition hover:-translate-y-[1px]"
										href={project.github}
										target="_blank"
										rel="noreferrer"
									>
										<span class="text-[11px] uppercase text-slate-600">GitHub</span>
										<span class="flex items-center gap-2 text-sm font-semibold">
											Repo
											<svg viewBox="0 0 16 16" class="h-4 w-4 fill-current">
												<path
													fill-rule="evenodd"
													d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8Z"
												/>
											</svg>
										</span>
									</a>
								{:else}
									<div class="flex h-full items-center justify-between rounded-md border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 shadow-[3px_3px_0_#0f172a]">
										<span class="text-[11px] uppercase">GitHub</span>
										<span class="text-sm">Not linked</span>
									</div>
								{/if}
							</div>
							<div class="flex flex-wrap gap-2">
								{#each project.tags.slice(0, 3) as tag}
									<span
										class={`rounded-sm border px-2 py-1 text-xs font-semibold ${pastelClass(tag)} shadow-[2px_2px_0_#0f172a]`}
									>
										{tag}
									</span>
								{/each}
								{#if project.tags.length > 3}
									<span class="rounded-sm border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800 shadow-[2px_2px_0_#0f172a]">
										+{project.tags.length - 3}
									</span>
								{/if}
							</div>
						</article>
					{/each}
				{/if}
			</div>
			{#if filteredWithSearch.length > visibleCount}
				<div class="mt-4 flex justify-center">
					<button
						class="rounded-md border-2 border-slate-900 bg-white px-4 py-2 text-sm font-semibold shadow-[4px_4px_0_#0f172a] transition hover:-translate-y-[1px]"
						type="button"
						onclick={() => (visibleCount += 6)}
					>
						Load more
					</button>
				</div>
			{/if}
		</section>
		<section id="apply" class="space-y-6 border-t-2 border-slate-900 py-10">
			<div class="flex flex-col gap-3 rounded-lg border-2 border-slate-900 bg-white p-6 shadow-[8px_8px_0_#0f172a]">
				<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Join the team</p>
				<h2 class="text-3xl font-semibold">Build with Contrib.Club</h2>
				<p class="text-slate-700">
					We look for contributors who ship regularly, care about quality, and can own an idea end-to-end. Drop your GitHub, and we’ll review your work before inviting you to the org.
				</p>
				<form class="mt-4 grid gap-4 md:grid-cols-2" onsubmit={submitApplication}>
					<div class="md:col-span-1">
						<label class="text-sm text-slate-700" for="app-name">Full name</label>
						<input
							id="app-name"
							class="mt-2 w-full rounded-lg border-2 border-slate-900 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 shadow-[3px_3px_0_#0f172a] focus:border-slate-700 focus:outline-none"
							placeholder="Your name"
							type="text"
							value={applyName}
							oninput={(event) => (applyName = event.currentTarget.value)}
						/>
					</div>
					<div class="md:col-span-1">
						<label class="text-sm text-slate-700" for="app-email">Email</label>
						<input
							id="app-email"
							class="mt-2 w-full rounded-lg border-2 border-slate-900 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 shadow-[3px_3px_0_#0f172a] focus:border-slate-700 focus:outline-none"
							placeholder="you@example.com"
							type="email"
							value={applyEmail}
							oninput={(event) => (applyEmail = event.currentTarget.value)}
						/>
					</div>
					<div class="md:col-span-2">
						<label class="text-sm text-slate-700" for="app-github">GitHub profile</label>
						<div class="mt-2 flex flex-col gap-3 rounded-lg border-2 border-slate-900 bg-white p-3 shadow-[3px_3px_0_#0f172a] sm:flex-row sm:items-center">
							{#if githubStatus.state === 'valid'}
								<div class="flex w-full items-center gap-3 rounded-md border-2 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 shadow-[3px_3px_0_#0f172a]">
									<span class="text-emerald-700">✓</span>
									{#if githubStatus.avatar}
										<img
											alt="GitHub avatar"
											class="h-9 w-9 rounded-md border border-emerald-300 object-cover"
											src={githubStatus.avatar}
										/>
									{/if}
									<span class="truncate">{githubStatus.name}</span>
								</div>
								<button
									class="inline-flex items-center justify-center rounded-md border-2 border-slate-900 bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-[3px_3px_0_#0f172a] transition hover:-translate-y-[1px]"
									type="button"
									onclick={resetGithubValidation}
								>
									Remove
								</button>
							{:else}
								<div class="flex w-full items-center gap-2 rounded-md border-2 border-slate-900 bg-slate-50 px-2 py-2">
									<span class="shrink-0 text-sm font-semibold text-slate-700">github.com/</span>
									<input
										id="app-github"
										class="w-full rounded-md border border-transparent bg-white px-2 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none"
										placeholder="your-handle"
										type="text"
										value={applyGithubUser}
										oninput={(event) => {
											applyGithubUser = event.currentTarget.value;
											if (githubStatus.state !== 'idle') githubStatus = { state: 'idle' };
										}}
									/>
								</div>
								<button
									class="inline-flex items-center justify-center rounded-md border-2 border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-[3px_3px_0_#0f172a] transition hover:-translate-y-[1px]"
									type="button"
									onclick={validateGithub}
								>
									{githubStatus.state === 'loading' ? 'Checking...' : 'Validate'}
								</button>
							{/if}
							{#if githubStatus.state === 'invalid'}
								<div class="rounded-md border-2 border-rose-500 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-[3px_3px_0_#0f172a]">
									Could not find that GitHub account
								</div>
							{/if}
						</div>
					</div>
					<div class="md:col-span-2">
						{#if formError}
							<p class="rounded-md border-2 border-rose-500 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-[3px_3px_0_#0f172a]">
								{formError}
							</p>
						{/if}
						{#if formSuccess}
							<p class="rounded-md border-2 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 shadow-[3px_3px_0_#0f172a]">
								{formSuccess}
							</p>
						{:else if formLoading}
							<p class="rounded-md border-2 border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 shadow-[3px_3px_0_#0f172a]">
								Sending your application...
							</p>
						{/if}
						<button
							class="w-full rounded-md border-2 border-slate-900 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-[4px_4px_0_#0f172a] transition hover:-translate-y-[2px]"
							type="submit"
							disabled={formLoading}
						>
							{#if formLoading}
								<span class="inline-flex items-center gap-2">
									<span class="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-l-white"></span>
									Sending application...
								</span>
							{:else}
								Submit application
							{/if}
						</button>
					</div>
				</form>
			</div>
		</section>

	</main>

	<footer class="mt-6 border-t-2 border-slate-900 bg-white">
		<div class="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-md border-2 border-slate-900 bg-white text-sm font-semibold shadow-[3px_3px_0_#0f172a]">
					CC
				</div>
				<div>
					<p class="text-lg font-semibold">Contributors Club</p>
					<p class="text-xs text-slate-600">A club for open-source contributors.</p>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-800">
				<a
					class="flex items-center justify-center rounded-md border-2 border-slate-900 bg-white p-2 shadow-[3px_3px_0_#0f172a] transition hover:-translate-y-[1px]"
					href="https://github.com"
					target="_blank"
					rel="noreferrer"
					aria-label="GitHub"
				>
					<svg viewBox="0 0 16 16" class="h-5 w-5 fill-current">
						<path
							fill-rule="evenodd"
							d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8Z"
						/>
					</svg>
				</a>
				<a
					class="flex items-center justify-center rounded-md border-2 border-slate-900 bg-white p-2 shadow-[3px_3px_0_#0f172a] transition hover:-translate-y-[1px]"
					href="https://x.com"
					target="_blank"
					rel="noreferrer"
					aria-label="X"
				>
					<svg viewBox="0 0 24 24" class="h-5 w-5 fill-current">
						<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.3l-4.927-6.437-5.64 6.437H2.423l7.73-8.828L1.902 2.25h6.083l4.45 5.845 5.81-5.845Zm-1.162 17.52h1.833L7.084 3.633H5.117l11.965 16.137Z" />
					</svg>
				</a>
				<a
					class="flex items-center justify-center rounded-md border-2 border-slate-900 bg-white p-2 shadow-[3px_3px_0_#0f172a] transition hover:-translate-y-[1px]"
					href="https://instagram.com"
					target="_blank"
					rel="noreferrer"
					aria-label="Instagram"
				>
					<svg viewBox="0 0 24 24" class="h-5 w-5 fill-current">
						<path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5Zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5Zm4.75-4.25a1 1 0 1 1-1 1 1 1 0 0 1 1-1Z" />
					</svg>
				</a>
			</div>
		</div>
	</footer>
</div>
