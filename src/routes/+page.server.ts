import type { PageServerLoad } from './$types';
type OrgRepo = {
	name: string;
	description: string | null;
	html_url: string;
	stargazers_count?: number;
	forks_count?: number;
	topics?: string[];
	language?: string | null;
	updated_at?: string;
	created_at?: string;
	homepage?: string | null;
};

type MemberDetail = {
	login: string;
	avatar_url: string;
	html_url: string;
	public_repos?: number;
	public_gists?: number;
	followers?: number;
	star_count?: number;
	name?: string | null;
};

type RepoActivity = { days?: number[] };

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

// Fetch per-day commit counts for a repo over a window (fallback when stats API lags)
async function fetchDailyCommitsForWindow(
	parsed: { owner: string; repo: string },
	headers: Record<string, string>,
	days = 60,
	now = Date.now()
) {
	const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
	const buckets = Array.from({ length: days }, () => 0);
	const maxPages = 5;
	for (let page = 1; page <= maxPages; page++) {
		const res = await fetch(
			`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?since=${encodeURIComponent(
				since
			)}&per_page=100&page=${page}`,
			{ headers }
		);
		if (!res.ok) break;
		const items: { commit?: { committer?: { date?: string }; author?: { date?: string } } }[] = await res.json();
		if (!Array.isArray(items) || items.length === 0) break;
		for (const item of items) {
			const dateString = item.commit?.committer?.date ?? item.commit?.author?.date;
			if (!dateString) continue;
			const ts = new Date(dateString).getTime();
			const diffDays = Math.floor((now - ts) / (1000 * 60 * 60 * 24));
			if (diffDays < 0 || diffDays >= days) continue;
			const bucketIndex = days - 1 - diffDays;
			buckets[bucketIndex] += 1;
		}
		const link = res.headers.get('link');
		if (!link || !link.includes('rel="next"')) break;
	}
	return buckets;
}

// Simple delay helper for retry backoff
function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Call GitHub stats API with retries/backoff to avoid transient 202 responses
async function fetchCommitActivityWithRetry(
	parsed: { owner: string; repo: string },
	headers: Record<string, string>,
	attempts = 3
) {
	let lastStatus: number | undefined;
	for (let i = 0; i < attempts; i++) {
		const res = await fetch(
			`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/stats/commit_activity`,
			{ headers }
		);
		lastStatus = res.status;
		if (res.status === 202) {
			if (i < attempts - 1) await sleep(1200);
			continue;
		}
		if (!res.ok) {
			return { ok: false, status: res.status, text: await res.text() };
		}
		const weeks: RepoActivity[] = await res.json();
		return { ok: true, status: res.status, weeks };
	}
	return { ok: false, status: lastStatus ?? 0, text: 'still 202 after retries' };
}

// Parse a GitHub repo URL into { owner, repo }
function parseRepo(url: string | undefined) {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.endsWith('github.com')) return null;
		const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
		return owner && repo ? { owner, repo } : null;
	} catch {
		return null;
	}
}

// Normalize a repo string/URL to https://github.com/{owner}/{repo}
function normalizeRepoUrl(value: string | undefined) {
	if (!value) return null;
	const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
	if (!trimmed) return null;

	if (/^https?:\/\//i.test(trimmed)) {
		try {
			const url = new URL(trimmed);
			if (!url.hostname.endsWith('github.com')) return null;
			url.hash = '';
			url.search = '';
			return url.toString();
		} catch {
			return null;
		}
	}

	if (!trimmed.includes('/')) return null;
	return `https://github.com/${trimmed}`;
}

// Normalize homepages we show on cards (strip bad protocols/hashes)
function normalizeHomepage(value: string | null | undefined) {
	if (!value || typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
	try {
		const url = new URL(withProtocol);
		if (!url.hostname) return null;
		url.hash = '';
		return url.toString();
	} catch {
		return null;
	}
}

// Normalize arbitrary websites (used for author links)
function normalizeWebsite(value: string | null | undefined) {
	if (!value || typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
	try {
		const url = new URL(withProtocol);
		if (!url.hostname) return null;
		url.hash = '';
		return url.toString();
	} catch {
		return null;
	}
}

// Convert a title to a URL-safe slug (with a fallback when needed)
function slugifyTitle(title: string, fallback: string) {
	const base = title
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-')
		.slice(0, 64);
	const safeFallback = fallback.replace(/[^a-z0-9-]/gi, '') || 'post';
	const slug = base || safeFallback.toLowerCase();
	return slug || 'post';
}

// Short pseudo-random ID for fallback slugs
function shortId() {
	return Math.random().toString(36).slice(2, 8);
}

type DbBlogRow = {
	slug?: string;
	title?: string;
	description?: string;
	content?: string;
	author?: string;
	author_url?: string | null;
	created_at?: string;
	modified_at?: string;
	reactions?: string | null;
};

// Ensure reaction objects are numeric, non-empty, and normalized
function normalizeReactionCounts(obj: any): Record<string, number> {
	const counts: Record<string, number> = {};
	if (!obj || typeof obj !== 'object') return counts;
	for (const [key, value] of Object.entries(obj)) {
		const emoji = String(key);
		const num = Number(value);
		if (!emoji || Number.isNaN(num) || num <= 0) continue;
		counts[emoji] = (counts[emoji] ?? 0) + Math.floor(num);
	}
	return counts;
}

// Parse stored reactions JSON into a usable counts map
function parseReactions(raw: string | null | undefined): Record<string, number> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.reduce((acc, emoji) => {
				const key = String(emoji);
				acc[key] = (acc[key] ?? 0) + 1;
				return acc;
			}, {} as Record<string, number>);
		}
		if (parsed && typeof parsed === 'object') {
			if ('counts' in parsed) {
				return normalizeReactionCounts((parsed as any).counts);
			}
			return normalizeReactionCounts(parsed);
		}
	} catch {
		return {};
	}
	return {};
}

// Map a DB row into a BlogEntry; returns null when required fields are missing
function mapDbBlog(row: DbBlogRow): BlogEntry | null {
	if (!row?.slug || !row.title) return null;
	let reactions: string[] = [];
	const reactionCounts = parseReactions(row.reactions);
	return {
		slug: row.slug,
		title: row.title,
		description: row.description ?? '',
		content: row.content ?? '',
		author: row.author ?? 'contributor-club',
		authorUrl: row.author_url ?? null,
		createdAt: row.created_at ?? new Date().toISOString(),
		modifiedAt: row.modified_at ?? row.created_at ?? new Date().toISOString(),
		reactions: reactionCounts
	};
}

async function fetchAuthorWebsite(author: string, headers: Record<string, string>) {
	try {
		const res = await fetch(`https://api.github.com/users/${author}`, { headers });
		if (!res.ok) return null;
		const profile: { blog?: string | null } = await res.json();
		return normalizeWebsite(profile.blog ?? null);
	} catch {
		return null;
	}
}

async function hydrateHomepages(
	repos: OrgRepo[],
	headers: Record<string, string>,
	limit = 10
) {
	const missing = repos.filter((repo) => !normalizeHomepage(repo.homepage) && repo.html_url);
	for (const repo of missing.slice(0, limit)) {
		const parsed = parseRepo(repo.html_url);
		if (!parsed) continue;
		try {
			const res = await fetch(
				`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
				{ headers }
			);
			if (!res.ok) continue;
			const repoData: OrgRepo = await res.json();
			const homepage = normalizeHomepage(repoData.homepage ?? null);
			if (homepage) {
				repo.homepage = homepage;
			}
		} catch (error) {
			console.error('Failed to hydrate homepage for', repo.html_url, error);
		}
	}
}

type Env = {
	GITHUB_TOKEN?: string;
	CACHE_DB?: any;
};

type CachedPayload = {
	githubStats: { stars: number; forks: number; contributors: number };
	repoStats: Record<string, { stars: number; forks: number; activity?: number[] }>;
	orgRepos: OrgRepo[];
	memberRepos: OrgRepo[];
	orgMembers: { login: string; avatar_url: string; html_url: string }[];
	memberDetails: MemberDetail[];
	blogPosts: BlogEntry[];
};

const memoryCache: { timestamp: number; payload: CachedPayload | null } = {
	timestamp: 0,
	payload: null
};
const CACHE_TTL = 1000 * 60 * 15; // 15 minutes cache freshness
const ACTIVITY_TTL = 1000 * 60 * 60 * 24; // fetch contribution activity at most once per 24h
const ACTIVITY_RETRY_TTL = 1000 * 60 * 15; // retry sooner when activity is missing
const RATE_LIMIT_COOLDOWN = 1000 * 60 * 15; // 15 minutes before retrying after a 403/429
let rateLimitUntil = 0;
const D1_CACHE_KEY = 'github-cache';

async function persistActivity(
	d1: any,
	activityTableReady: boolean,
	activityCache: Map<string, { activity: number[]; timestamp: number }>,
	repoUrl: string,
	activity: number[],
	timestamp: number
) {
	activityCache.set(repoUrl, { activity, timestamp });
	const total = activity.reduce((sum, value) => sum + value, 0);
	const hasData = activity.length > 0;
	console.log('Activity cache update', { repoUrl, days: activity.length, total, timestamp, persisted: hasData });
	if (!hasData) {
		console.warn('Activity persistence skipped (no data yet)', { repoUrl, timestamp });
	}
	if (!hasData || !d1 || !activityTableReady) return;
	try {
		await d1
			.prepare('INSERT OR REPLACE INTO repo_activity_cache (repo_url, activity, timestamp) VALUES (?, ?, ?)')
			.bind(repoUrl, JSON.stringify(activity), timestamp)
			.run();
	} catch (error) {
		console.error('Failed to persist activity for', repoUrl, error);
	}
}

export const load: PageServerLoad = async ({ fetch, platform }) => {
	// Cloudflare Worker secret is exposed via platform.env; fall back to process/import.meta for local dev
	const cfEnv = (platform?.env as Env | undefined) ?? undefined;
	const githubToken =
		cfEnv?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? (import.meta as any)?.env?.GITHUB_TOKEN;
	const acceptTopics = 'application/vnd.github+json, application/vnd.github.mercy-preview+json';
	const authHeader: Record<string, string> = githubToken ? { authorization: `token ${githubToken}` } : {};
	const baseHeaders: Record<string, string> = {
		accept: acceptTopics,
		'X-GitHub-Api-Version': '2022-11-28',
		'user-agent': 'contrib-club-worker/1.0 (+https://contrib.club)'
	};
	const headers: Record<string, string> = {
		...baseHeaders,
		...authHeader
	};
	const publicHeaders = baseHeaders;

	if (!githubToken) {
		console.warn('GITHUB_TOKEN not found; GitHub API requests will be rate-limited.');
	} else {
		const keys = cfEnv ? Object.keys(cfEnv) : [];
		let source = 'platform.env';
		if (!cfEnv?.GITHUB_TOKEN && process.env.GITHUB_TOKEN) source = 'process.env';
		if (!cfEnv?.GITHUB_TOKEN && (import.meta as any)?.env?.GITHUB_TOKEN) source = 'import.meta.env';
		console.log('GITHUB_TOKEN detected (length):', githubToken.length, 'source:', source, 'platform.env keys:', keys);
	}

	const org = 'contributor-club';

	let stars = 0;
	let forks = 0;
	const repoStats: Record<string, { stars: number; forks: number; activity?: number[] }> = {};
	let orgMembers = 0;
	let orgMembersList: { login: string; avatar_url: string; html_url: string }[] = [];
	let memberDetails: MemberDetail[] = [];
	let orgRepos: OrgRepo[] = [];
	let memberRepos: OrgRepo[] = [];
	let blogPosts: BlogEntry[] = [];
	let blogError: string | null = null;
	let fallbackRepoCache: string[] = [];
	let fallbackRepoUrls: string[] = [];
	let rateLimited = false;
	const d1 = cfEnv?.CACHE_DB;
	const allowD1InDev = import.meta.env?.VITE_USE_D1 === 'true' || process.env.USE_D1 === 'true';
	const canUseD1 = Boolean(d1 && typeof d1.prepare === 'function' && (!dev || allowD1InDev));
	if (dev && !allowD1InDev && d1) {
		console.warn('D1 detected but disabled in dev mode. Set VITE_USE_D1=true to enable locally.');
	}
	let persistedPayload: CachedPayload | null = null;
	let persistedTimestamp = 0;
	let persistedRateUntil = 0;

	// Load fallback URLs from bundled file (cached in-memory for the request)
	try {
		const fallbackModule = await import('$lib/fallback.txt?raw');
		fallbackRepoCache = fallbackModule.default
			.split(/\r?\n/)
			.map((line: string) => line.trim())
			.filter(Boolean);
		fallbackRepoUrls = Array.from(
			new Set(
				fallbackRepoCache
					.map((value) => normalizeRepoUrl(value))
					.filter((url): url is string => Boolean(url))
			)
		);
	} catch (error) {
		console.error('Failed to load fallback repo list', error);
	}

	const now = Date.now();

	// Try loading persisted cache from D1 (shared across instances)
	if (canUseD1) {
		try {
			await d1
				.prepare(
					'CREATE TABLE IF NOT EXISTS github_cache (id TEXT PRIMARY KEY, payload TEXT, timestamp INTEGER, rate_limit_until INTEGER)'
				)
				.run();
			const row = (await d1
				.prepare('SELECT payload, timestamp, rate_limit_until FROM github_cache WHERE id = ?')
				.bind(D1_CACHE_KEY)
				.first()) as { payload?: string; timestamp?: number; rate_limit_until?: number } | null;
			if (row?.payload) {
				persistedPayload = JSON.parse(row.payload) as CachedPayload;
				persistedTimestamp = row.timestamp ?? 0;
				persistedRateUntil = row.rate_limit_until ?? 0;
			}
		} catch (error) {
			console.error('Failed to read D1 cache', error);
		}
	}

	// If we recently hit rate limits, avoid making fresh GitHub calls and serve cache/fallback
	if (now < rateLimitUntil || now < persistedRateUntil) {
		if (memoryCache.payload && now - memoryCache.timestamp < CACHE_TTL) {
			console.warn('Rate limit cooldown active; serving cached payload.');
			return memoryCache.payload;
		}
		if (persistedPayload && now - persistedTimestamp < CACHE_TTL) {
			console.warn('Rate limit cooldown active; serving persisted cache.');
			return persistedPayload;
		}
		if (fallbackRepoUrls.length > 0) {
			console.warn('Rate limit cooldown active; serving fallback repo list.');
			const fallbackPayload: CachedPayload = {
				githubStats: { stars: 0, forks: 0, contributors: 0 },
				repoStats: {},
				orgRepos: fallbackRepoUrls.map((repoUrl) => ({
					name: parseRepo(repoUrl)?.repo ?? repoUrl,
					description: 'Fallback repository (cached list)',
					html_url: repoUrl,
					stargazers_count: 0,
					forks_count: 0,
					topics: ['fallback'],
					language: 'General',
					updated_at: new Date().toISOString(),
					created_at: new Date().toISOString(),
					homepage: null
				})),
				memberRepos: [],
				orgMembers: [],
				memberDetails: [],
				blogPosts: []
			};
			return fallbackPayload;
		}
	}

	// Load fallback URLs from bundled file (cached in-memory for the request)
	try {
		const membersRes = await fetch(`https://api.github.com/orgs/${org}/members?per_page=100`, { headers });
		if (membersRes.ok) {
			const members: { login: string; avatar_url: string; html_url: string }[] = await membersRes.json();
			orgMembers = members.length;
			orgMembersList = members;
		} else {
			console.error('Org members fetch failed', membersRes.status, await membersRes.text());
			if (membersRes.status === 403 || membersRes.status === 429) rateLimited = true;
		}
	} catch (error) {
		console.error('Failed to load org members', error);
	}

	// Enrich member profiles with additional stats (public repos, followers, stars sum)
	if (orgMembersList.length > 0) {
		try {
			memberDetails = await Promise.all(
				orgMembersList.map(async (member) => {
					let profile: Partial<MemberDetail> = {};
					try {
						const userRes = await fetch(`https://api.github.com/users/${member.login}`, { headers });
						if (userRes.ok) {
							const userData = await userRes.json();
							profile = {
								public_repos: userData.public_repos,
								public_gists: userData.public_gists,
								followers: userData.followers,
								name: userData.name
							};
						}
					} catch (error) {
						console.error('Failed to load user profile for', member.login, error);
					}

					let starSum = 0;
					try {
						const reposRes = await fetch(
							`https://api.github.com/users/${member.login}/repos?per_page=100&type=public&sort=updated`,
							{ headers }
						);
						if (reposRes.ok) {
							const repos: { stargazers_count?: number }[] = await reposRes.json();
							starSum = repos.reduce((sum, repo) => sum + (repo.stargazers_count ?? 0), 0);
						}
					} catch (error) {
						console.error('Failed to load repo stars for', member.login, error);
					}

					return {
						login: member.login,
						avatar_url: member.avatar_url,
						html_url: member.html_url,
						star_count: starSum,
						...profile
					};
				})
			);
		} catch (error) {
			console.error('Failed to enrich member details', error);
		}
	}

	// Fallback to public members if private members are hidden or token missing
	if (orgMembersList.length === 0) {
		try {
			const publicMembersRes = await fetch(
				`https://api.github.com/orgs/${org}/public_members?per_page=100`,
				{ headers: { ...publicHeaders, accept: 'application/vnd.github+json' } }
			);
			if (publicMembersRes.ok) {
				const publicMembers: { login: string; avatar_url: string; html_url: string }[] =
					await publicMembersRes.json();
				orgMembers = publicMembers.length;
				orgMembersList = publicMembers;
			} else {
				console.error('Public org members fetch failed', publicMembersRes.status, await publicMembersRes.text());
				if (publicMembersRes.status === 403 || publicMembersRes.status === 429) rateLimited = true;
			}
		} catch (error) {
			console.error('Failed to load public org members', error);
		}
	}

	try {
		const repoUrls = [
			`https://api.github.com/orgs/${org}/repos?per_page=100&type=public&sort=updated`,
			`https://api.github.com/users/${org}/repos?per_page=100&type=public&sort=updated`
		];

		let loaded = false;
		for (const url of repoUrls) {
			const headerSet = githubToken ? headers : publicHeaders;
			try {
				const reposRes = await fetch(url, { headers: headerSet });
				if (!reposRes.ok) {
					console.error('Repo fetch failed', url, reposRes.status, await reposRes.text());
					if (reposRes.status === 403 || reposRes.status === 429) rateLimited = true;
					continue;
				}
				const reposData: OrgRepo[] = await reposRes.json();
				if (reposData.length === 0) continue;

				orgRepos = reposData.map((repo) => ({
					name: repo.name,
					description: repo.description,
					html_url: repo.html_url,
					stargazers_count: repo.stargazers_count ?? 0,
					forks_count: repo.forks_count ?? 0,
					topics: repo.topics ?? [],
					language: repo.language,
					updated_at: repo.updated_at,
					created_at: (repo as any).created_at,
					homepage: normalizeHomepage(repo.homepage ?? null)
				}));

				for (const repo of orgRepos) {
					const repoStars = repo.stargazers_count ?? 0;
					const repoForks = repo.forks_count ?? 0;
					repoStats[repo.html_url] = {
						stars: repoStars,
						forks: repoForks
					};
					stars += repoStars;
					forks += repoForks;
				}
				loaded = true;
				break;
			} catch (error) {
				console.error('Failed to load repos from', url, error);
			}
		}

		// Fallback to local list when API fails
		if (!loaded && fallbackRepoUrls.length > 0) {
			orgRepos = fallbackRepoUrls.map((repoUrl) => ({
				name: parseRepo(repoUrl)?.repo ?? repoUrl,
				description: 'Fallback repository (cached list)',
				html_url: repoUrl,
				stargazers_count: 0,
				forks_count: 0,
				topics: ['fallback'],
				language: 'General',
				updated_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
				homepage: null
			}));
		}
	} catch (error) {
		console.error('Failed to load org repositories', error);
	}

	// Load curated fallback repositories and merge them into the org repo list
	let fallbackRepos: OrgRepo[] = [];
	if (fallbackRepoUrls.length > 0) {
		const headerSet = githubToken ? headers : publicHeaders;
		try {
			const fetchedFallbacks = await Promise.all(
				fallbackRepoUrls.map(async (repoUrl) => {
					const parsed = parseRepo(repoUrl);
					if (!parsed) return null;

					try {
						const repoRes = await fetch(
							`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
							{ headers: headerSet }
						);

						if (repoRes.ok) {
							const repoData: OrgRepo = await repoRes.json();
							return {
								name: repoData.name ?? parsed.repo,
								description: repoData.description ?? 'Fallback repository (cached list)',
								html_url: repoData.html_url ?? repoUrl,
								stargazers_count: repoData.stargazers_count ?? 0,
								forks_count: repoData.forks_count ?? 0,
								topics: repoData.topics ?? [],
								language: repoData.language,
								updated_at: repoData.updated_at,
								created_at: (repoData as any).created_at,
								homepage: normalizeHomepage(repoData.homepage ?? null)
							};
						}

						if (repoRes.status === 403 || repoRes.status === 429) rateLimited = true;
					} catch (error) {
						console.error('Failed to load fallback repo', repoUrl, error);
					}

					return {
						name: parsed.repo,
						description: 'Fallback repository (cached list)',
						html_url: repoUrl,
						stargazers_count: 0,
						forks_count: 0,
						topics: ['fallback'],
						language: 'General',
						updated_at: new Date().toISOString(),
						created_at: new Date().toISOString(),
						homepage: null
					};
				})
			);

			fallbackRepos = fetchedFallbacks.filter(Boolean) as OrgRepo[];
		} catch (error) {
			console.error('Failed to process fallback repos', error);
		}

			const orgRepoUrls = new Set(
				orgRepos.map((repo) => repo.html_url).filter((url): url is string => Boolean(url))
			);
			for (const repo of fallbackRepos) {
				const url = repo.html_url;
				if (!url || orgRepoUrls.has(url)) continue;
				orgRepos.push(repo);
				orgRepoUrls.add(url);
			}

		// Deduplicate org repos in case of overlap
		orgRepos = Array.from(
			new Map(
				orgRepos
					.filter((repo) => repo.html_url)
					.map((repo) => [repo.html_url as string, repo])
			).values()
		);
	}

	// Fetch member repositories with contrib.club topic
	if (orgMembersList.length > 0) {
		try {
			const memberRepoRequests = orgMembersList.map(async (member) => {
				const topics = ['contrib-club', 'contrib.club'];
				const results: OrgRepo[] = [];

				for (const topic of topics) {
					const url = `https://api.github.com/search/repositories?q=user:${member.login}+topic:${topic}&per_page=100&sort=updated`;
					try {
						const res = await fetch(url, { headers });
						if (!res.ok) continue;
						const json = await res.json();
						const repos: OrgRepo[] = json.items ?? [];
						results.push(...repos);
					} catch (error) {
						console.error('Failed to load member repos for', member.login, error);
					}
				}

				const deduped = Array.from(new Map(results.map((repo) => [repo.html_url, repo])).values());
				return deduped;
			});

			const memberRepoResults = await Promise.all(memberRepoRequests);
			const orgRepoUrls = new Set(
				orgRepos.map((repo) => repo.html_url).filter((url): url is string => Boolean(url))
			);
			memberRepos = Array.from(
				new Map(
					memberRepoResults
						.flat()
						.filter((repo) => repo.html_url && !orgRepoUrls.has(repo.html_url))
						.map((repo) => [
							repo.html_url as string,
							{ ...repo, homepage: normalizeHomepage(repo.homepage ?? null) }
						])
				).values()
			);

			for (const repo of memberRepos) {
				const repoStars = repo.stargazers_count ?? 0;
				const repoForks = repo.forks_count ?? 0;
				repoStats[repo.html_url] = {
					stars: repoStars,
					forks: repoForks
				};
				stars += repoStars;
				forks += repoForks;
			}
		} catch (error) {
			console.error('Failed to aggregate member repos', error);
		}
	}

	// Deduplicate across all repos and rebuild stats so we can cache curated fallbacks too
	const combinedRepos = Array.from(
		new Map(
			[...orgRepos, ...memberRepos]
				.filter((repo) => repo.html_url)
				.map((repo) => [repo.html_url as string, repo])
		).values()
	);
	for (const key of Object.keys(repoStats)) delete repoStats[key];
	stars = 0;
	forks = 0;

	for (const repo of combinedRepos) {
		const repoUrl = repo.html_url as string;
		const repoStars = repo.stargazers_count ?? 0;
		const repoForks = repo.forks_count ?? 0;
		repoStats[repoUrl] = {
			...repoStats[repoUrl],
			stars: repoStars,
			forks: repoForks
		};
		stars += repoStars;
		forks += repoForks;
	}

	// Fill in missing homepage links (if any) to keep cache useful for visit buttons
	await hydrateHomepages(combinedRepos, githubToken ? headers : publicHeaders, 12);

	// Prepare per-repo activity cache (persisted daily to avoid API spam)
	const activityCache = new Map<string, { activity: number[]; timestamp: number }>();
	const activityMaxAge = 1000 * 60 * 60 * 24 * 2; // force refresh if older than 2 days (guard against clock skew)
	let activityTableReady = false;
	if (canUseD1) {
		try {
			await d1
				.prepare(
					'CREATE TABLE IF NOT EXISTS repo_activity_cache (repo_url TEXT PRIMARY KEY, activity TEXT, timestamp INTEGER)'
				)
				.run();
			try {
			const cachedRows = await d1
				.prepare('SELECT repo_url, activity, timestamp FROM repo_activity_cache')
				.all();
			activityTableReady = true;
			for (const row of (cachedRows?.results as { repo_url: string; activity: string; timestamp: number }[] | undefined) ?? []) {
				if (!row?.repo_url) continue;
				try {
					const parsed = row.activity ? (JSON.parse(row.activity) as number[]) : [];
					activityCache.set(row.repo_url, { activity: parsed ?? [], timestamp: row.timestamp ?? 0 });
				} catch (error) {
						console.error('Failed to parse cached activity for', row.repo_url, error);
					}
				}
			} catch (error) {
				console.error('Failed to read activity cache rows', error);
			}
		} catch (error) {
			console.error('Failed to initialize activity cache', error);
		}
	}

	// Fetch commit activity (last year) for all repos we know about
	const allRepoUrls = combinedRepos.map((repo) => repo.html_url as string);
	const activityFetchTime = Date.now();
	const repoUrlsNeedingActivity: string[] = [];
	const activityHeaders = githubToken ? headers : publicHeaders;

	for (const repoUrl of allRepoUrls) {
		const cached = activityCache.get(repoUrl);
		const hasData = (cached?.activity?.length ?? 0) > 0;
		const ttl = hasData ? ACTIVITY_TTL : ACTIVITY_RETRY_TTL;
		const age = cached ? activityFetchTime - cached.timestamp : null;
		const tooOld = age !== null && age > activityMaxAge;
		console.log('Activity cache check', {
			repoUrl,
			hasCached: Boolean(cached),
			hasData,
			ageMs: age,
			ttlMs: ttl,
			tooOld
		});
		if (cached && activityFetchTime - cached.timestamp < ttl && !tooOld) {
			const cachedActivity = cached?.activity ?? [];
			repoStats[repoUrl] = {
				...repoStats[repoUrl],
				activity: cachedActivity
			};
			console.log('Activity cache hit', { repoUrl, days: cachedActivity.length });
		} else {
			console.log('Activity cache stale or missing; fetching', { repoUrl });
			repoUrlsNeedingActivity.push(repoUrl);
		}
	}

	for (const repoUrl of repoUrlsNeedingActivity) {
		const parsed = parseRepo(repoUrl);
		if (!parsed) continue;

		try {
			console.log('Activity fetch start', { repoUrl });
			const activityResult = await fetchCommitActivityWithRetry(parsed, activityHeaders, 3);

			if (activityResult.status === 202) {
				console.warn('Commit activity still generating after retries for', repoUrl);
				const cached = activityCache.get(repoUrl);
				const fallbackActivity = cached?.activity ?? [];
				if (fallbackActivity.length > 0) {
					repoStats[repoUrl] = {
						...repoStats[repoUrl],
						activity: fallbackActivity
					};
					await persistActivity(canUseD1 ? d1 : null, activityTableReady, activityCache, repoUrl, fallbackActivity, activityFetchTime);
					continue;
				}

				try {
					const daily = await fetchDailyCommitsForWindow(parsed, activityHeaders, 60, activityFetchTime);
					repoStats[repoUrl] = {
						...repoStats[repoUrl],
						activity: daily
					};
					console.log('Activity fallback via commits API (after 202)', {
						repoUrl,
						days: daily.length,
						total: daily.reduce((sum, v) => sum + v, 0)
					});
					await persistActivity(canUseD1 ? d1 : null, activityTableReady, activityCache, repoUrl, daily, activityFetchTime);
					continue;
				} catch (error) {
					console.error('Fallback commit history failed for', repoUrl, error);
					const emptyActivity: number[] = [];
					repoStats[repoUrl] = { ...repoStats[repoUrl], activity: emptyActivity };
					await persistActivity(
						canUseD1 ? d1 : null,
						activityTableReady,
						activityCache,
						repoUrl,
						emptyActivity,
						activityFetchTime
					);
					continue;
				}
			}

			if (!activityResult.ok) {
				console.error('Activity fetch failed', repoUrl, activityResult.status, activityResult.text);
				if (activityResult.status === 403 || activityResult.status === 429) rateLimited = true;
				const cached = activityCache.get(repoUrl);
				const fallbackActivity = cached?.activity ?? [];
				if (fallbackActivity.length > 0) {
					repoStats[repoUrl] = {
						...repoStats[repoUrl],
						activity: fallbackActivity
					};
					await persistActivity(canUseD1 ? d1 : null, activityTableReady, activityCache, repoUrl, fallbackActivity, activityFetchTime);
					continue;
				}

				try {
					const daily = await fetchDailyCommitsForWindow(parsed, activityHeaders, 60, activityFetchTime);
					repoStats[repoUrl] = {
						...repoStats[repoUrl],
						activity: daily
					};
					console.log('Activity fallback via commits API (after error)', {
						repoUrl,
						days: daily.length,
						total: daily.reduce((sum, v) => sum + v, 0)
					});
					await persistActivity(canUseD1 ? d1 : null, activityTableReady, activityCache, repoUrl, daily, activityFetchTime);
				} catch (error) {
					console.error('Fallback commit history failed for', repoUrl, error);
					const emptyActivity: number[] = [];
					repoStats[repoUrl] = { ...repoStats[repoUrl], activity: emptyActivity };
					await persistActivity(
						canUseD1 ? d1 : null,
						activityTableReady,
						activityCache,
						repoUrl,
						emptyActivity,
						activityFetchTime
					);
				}
				continue;
			}

			const weeks: RepoActivity[] = activityResult.weeks ?? [];
			if (!Array.isArray(weeks)) continue;

			const activity = weeks.flatMap((week) => week.days ?? []).slice(-364);
			repoStats[repoUrl] = {
				...repoStats[repoUrl],
				stars: repoStats[repoUrl]?.stars ?? 0,
				forks: repoStats[repoUrl]?.forks ?? 0,
				activity
			};
			console.log('Activity fetched via stats endpoint', {
				repoUrl,
				days: activity.length,
				total: activity.reduce((sum, v) => sum + v, 0)
			});

			await persistActivity(canUseD1 ? d1 : null, activityTableReady, activityCache, repoUrl, activity, activityFetchTime);
		} catch (error) {
			console.error('Failed to load commit activity for', repoUrl, error);
			const cached = activityCache.get(repoUrl);
			const fallbackActivity = cached?.activity ?? [];
			repoStats[repoUrl] = {
				...repoStats[repoUrl],
				activity: fallbackActivity
			};
			await persistActivity(canUseD1 ? d1 : null, activityTableReady, activityCache, repoUrl, fallbackActivity, activityFetchTime);
		}
	}

	// Fetch blogs (D1-backed; seeded from wiki as fallback)
	let wikiBlogEntries: BlogEntry[] = [];
	try {
		const wikiOwner = org;
		const wikiRepo = 'contrib.club.wiki';
		const contentsRes = await fetch(`https://api.github.com/repos/${wikiOwner}/${wikiRepo}/contents`, {
			headers: githubToken ? headers : publicHeaders
		});
		console.log('Wiki contents response', contentsRes.status, contentsRes.statusText);

		if (contentsRes.ok) {
			const files: { name: string; path: string; download_url?: string; type: string; url: string }[] =
				await contentsRes.json();

			const markdownFiles = files.filter((file) => file.type === 'file' && file.name.endsWith('.md'));

			wikiBlogEntries = (
				await Promise.all(
					markdownFiles.map(async (file) => {
						const rawUrl =
							file.download_url ??
							`https://raw.githubusercontent.com/${wikiOwner}/${wikiRepo}/master/${file.path}`;
						let content = '';
						try {
							const contentRes = await fetch(rawUrl, { headers: githubToken ? headers : publicHeaders });
							console.log('Wiki file response', file.path, contentRes.status, contentRes.statusText);
							if (contentRes.ok) {
								content = await contentRes.text();
							} else {
								console.warn('Wiki file fetch not ok', { path: file.path, status: contentRes.status });
							}
						} catch (error) {
							console.error('Failed to fetch wiki content for', file.path, error);
						}

						let latestDate: string | undefined;
						try {
							const commitRes = await fetch(
								`https://api.github.com/repos/${wikiOwner}/${wikiRepo}/commits?path=${encodeURIComponent(file.path)}&per_page=1`,
								{ headers: githubToken ? headers : publicHeaders }
							);
							if (commitRes.ok) {
								const commits: { commit: { committer?: { date?: string }; author?: { date?: string } } }[] =
									await commitRes.json();
								latestDate =
									commits[0]?.commit?.committer?.date ??
									commits[0]?.commit?.author?.date ??
									undefined;
							} else {
								console.warn('Wiki commit fetch not ok', { path: file.path, status: commitRes.status });
							}
						} catch (error) {
							console.error('Failed to load wiki commit date for', file.path, error);
						}

						const lines = content
							.split(/\r?\n/)
							.map((line) => line.trim())
							.filter(Boolean);
						const heading = lines.find((line) => line.startsWith('#'))?.replace(/^#+\s*/, '');
						const bodyLine = lines.find((line) => !line.startsWith('#'));
						const fileTitle = file.name.replace(/\.md$/, '').replace(/[-_]/g, ' ');
						const title = heading || fileTitle;
						const description = bodyLine || heading || 'Read more from the Contrib.Club wiki.';
						const rawSlug = file.name.replace(/\.md$/, '');
						const slug = slugifyTitle(title, rawSlug || shortId());
						const createdAt = latestDate ?? new Date().toISOString();

						return {
							slug,
							title,
							description,
							content,
							author: 'contributor-club',
							authorUrl: null,
							createdAt,
							modifiedAt: latestDate ?? createdAt,
							reactions: {}
						} satisfies BlogEntry;
					})
				)
			)
				.filter(Boolean)
				.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
		} else if (contentsRes.status === 403 || contentsRes.status === 429) {
			rateLimited = true;
			console.warn('Wiki contents rate limited', contentsRes.status);
		} else {
			console.error('Wiki contents fetch failed', contentsRes.status, contentsRes.statusText);
		}
	} catch (error) {
		console.error('Failed to load wiki posts', error);
	}

const blogMap = new Map<string, BlogEntry>();

	if (!canUseD1) {
		console.warn('D1 not available for blogs; falling back to wiki only.');
	}

	// Load from D1 if available
	if (canUseD1) {
		try {
			await d1
				.prepare(
					'CREATE TABLE IF NOT EXISTS blogs (slug TEXT PRIMARY KEY, title TEXT, description TEXT, content TEXT, author TEXT, author_url TEXT, created_at TEXT, modified_at TEXT, reactions TEXT)'
				)
				.run();
			try {
				await d1.prepare('ALTER TABLE blogs ADD COLUMN author_url TEXT').run();
			} catch {
				// ignore if already exists
			}
			const rows = await d1
				.prepare(
					'SELECT slug, title, description, content, author, author_url, created_at, modified_at, reactions FROM blogs'
				)
				.all();
			console.log('Blogs loaded from D1', rows?.results?.length ?? 0);
			for (const row of (rows?.results as DbBlogRow[] | undefined) ?? []) {
				const entry = mapDbBlog(row);
				if (entry) blogMap.set(entry.slug, entry);
			}
		} catch (error) {
			console.error('Failed to load blogs from D1', error);
		}
	}

	// Seed missing entries from wiki into DB (or in-memory when D1 absent)
	for (const entry of wikiBlogEntries) {
		let slug = entry.slug;
		while (blogMap.has(slug)) {
			slug = `${entry.slug}-${shortId()}`;
		}
		const finalEntry = { ...entry, slug };
		if (!blogMap.has(slug)) {
			blogMap.set(slug, finalEntry);
		}

		if (canUseD1) {
			try {
				await d1
					.prepare(
						'INSERT OR IGNORE INTO blogs (slug, title, description, content, author, author_url, created_at, modified_at, reactions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
					)
					.bind(
						finalEntry.slug,
						finalEntry.title,
						finalEntry.description,
						finalEntry.content,
						finalEntry.author,
						finalEntry.authorUrl ?? null,
						finalEntry.createdAt,
						finalEntry.modifiedAt,
						JSON.stringify({ counts: finalEntry.reactions ?? {}, ipMap: {} })
					)
					.run();
			} catch (error) {
				console.error('Failed to seed wiki blog into D1', error);
			}
		}
	}

	blogPosts = Array.from(blogMap.values()).sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	);
	if (blogMap.size > 0) {
		blogError = null;
	}
	// Populate author websites from GitHub profiles (fallback to stored authorUrl if fetch fails)
	if (blogPosts.length > 0) {
		const uniqueAuthors = Array.from(new Set(blogPosts.map((post) => post.author).filter(Boolean)));
		const authorWebsites = new Map<string, string | null>();
		const headerSet = githubToken ? headers : publicHeaders;
		await Promise.all(
			uniqueAuthors.map(async (author) => {
				const site = await fetchAuthorWebsite(author, headerSet);
				if (site) authorWebsites.set(author, site);
			})
		);
		blogPosts = blogPosts.map((post) => ({
			...post,
			authorUrl: authorWebsites.get(post.author) ?? post.authorUrl ?? null
		}));
	}

	const payload: CachedPayload = {
		githubStats: { stars, forks, contributors: orgMembers },
		repoStats,
		orgRepos,
		memberRepos,
		orgMembers: orgMembersList,
		memberDetails,
		blogPosts,
		blogError: blogPosts.length > 0 ? null : 'Failed to load blogs.'
	};

	// Serve cached data if rate limited and cache is still fresh
	const nowFinal = Date.now();
	if (rateLimited && memoryCache.payload && nowFinal - memoryCache.timestamp < CACHE_TTL) {
		console.warn('Serving cached GitHub data due to rate limiting.');
		return memoryCache.payload;
	}
	if (rateLimited && persistedPayload && nowFinal - persistedTimestamp < CACHE_TTL) {
		console.warn('Serving persisted GitHub data due to rate limiting.');
		return persistedPayload;
	}

	if (rateLimited) {
		rateLimitUntil = nowFinal + RATE_LIMIT_COOLDOWN;
	}

	// Store fresh cache
	memoryCache.payload = payload;
	memoryCache.timestamp = now;

	if (canUseD1) {
		try {
			await d1
				.prepare(
					'CREATE TABLE IF NOT EXISTS github_cache (id TEXT PRIMARY KEY, payload TEXT, timestamp INTEGER, rate_limit_until INTEGER)'
				)
				.run();
			await d1
				.prepare(
					'INSERT OR REPLACE INTO github_cache (id, payload, timestamp, rate_limit_until) VALUES (?, ?, ?, ?)'
				)
				.bind(D1_CACHE_KEY, JSON.stringify(payload), nowFinal, rateLimitUntil || persistedRateUntil)
				.run();
		} catch (error) {
			console.error('Failed to persist cache to D1', error);
		}
	}

	return payload;
};
import { dev } from '$app/environment';
