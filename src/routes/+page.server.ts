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
	blogPosts: { title: string; excerpt: string; date?: string; url: string; content?: string }[];
};

const memoryCache: { timestamp: number; payload: CachedPayload | null } = {
	timestamp: 0,
	payload: null
};
const CACHE_TTL = 1000 * 60 * 15; // 15 minutes cache freshness
const RATE_LIMIT_COOLDOWN = 1000 * 60 * 15; // 15 minutes before retrying after a 403/429
let rateLimitUntil = 0;
const D1_CACHE_KEY = 'github-cache';

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
	let blogPosts: { title: string; excerpt: string; date?: string; url: string; content?: string }[] = [];
	let fallbackRepoCache: string[] = [];
	let fallbackRepoUrls: string[] = [];
	let rateLimited = false;
	const d1 = cfEnv?.CACHE_DB;
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
	if (d1) {
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
					created_at: new Date().toISOString()
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
					created_at: (repo as any).created_at
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
				created_at: new Date().toISOString()
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
								created_at: (repoData as any).created_at
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
						created_at: new Date().toISOString()
					};
				})
			);

			fallbackRepos = fetchedFallbacks.filter((repo): repo is OrgRepo => Boolean(repo));
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
						.map((repo) => [repo.html_url as string, repo])
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

	// Fetch commit activity (last year) for all repos we know about
	const allRepoUrls = combinedRepos.map((repo) => repo.html_url as string);

	for (const repoUrl of allRepoUrls) {
		const parsed = parseRepo(repoUrl);
		if (!parsed) continue;

		try {
			const activityRes = await fetch(
				`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/stats/commit_activity`,
				{ headers: githubToken ? headers : publicHeaders }
			);

			if (activityRes.status === 202) {
				console.warn('Commit activity still generating for', repoUrl);
				continue;
			}

			if (!activityRes.ok) {
				console.error('Activity fetch failed', repoUrl, activityRes.status, await activityRes.text());
				if (activityRes.status === 403 || activityRes.status === 429) rateLimited = true;
				continue;
			}

			const weeks: RepoActivity[] = await activityRes.json();
			if (!Array.isArray(weeks)) continue;

			const activity = weeks.flatMap((week) => week.days ?? []).slice(-364);
			repoStats[repoUrl] = {
				...repoStats[repoUrl],
				stars: repoStats[repoUrl]?.stars ?? 0,
				forks: repoStats[repoUrl]?.forks ?? 0,
				activity
			};
		} catch (error) {
			console.error('Failed to load commit activity for', repoUrl, error);
		}
	}

	// Fetch wiki pages as blog posts
	try {
		const wikiOwner = org;
		const wikiRepo = 'contrib.club.wiki';
		const contentsRes = await fetch(`https://api.github.com/repos/${wikiOwner}/${wikiRepo}/contents`, {
			headers: githubToken ? headers : publicHeaders
		});

		if (contentsRes.ok) {
			const files: { name: string; path: string; download_url?: string; type: string; url: string }[] =
				await contentsRes.json();

			const markdownFiles = files.filter((file) => file.type === 'file' && file.name.endsWith('.md'));

			const posts = await Promise.all(
				markdownFiles.map(async (file) => {
					const rawUrl =
						file.download_url ??
						`https://raw.githubusercontent.com/${wikiOwner}/${wikiRepo}/master/${file.path}`;
					let content = '';
					try {
						const contentRes = await fetch(rawUrl, { headers: githubToken ? headers : publicHeaders });
						if (contentRes.ok) {
							content = await contentRes.text();
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
					const excerpt = bodyLine || heading || 'Read more from the Contrib.Club wiki.';
					const slug = file.name.replace(/\.md$/, '');
					const url = `https://github.com/${wikiOwner}/contrib.club/wiki/${encodeURIComponent(slug)}`;

					return { title, excerpt, date: latestDate, url, content };
				})
			);

			blogPosts = posts
				.filter(Boolean)
				.sort((a, b) => {
					const aDate = a.date ? new Date(a.date).getTime() : 0;
					const bDate = b.date ? new Date(b.date).getTime() : 0;
					return bDate - aDate;
				});
		} else if (contentsRes.status === 403 || contentsRes.status === 429) {
			rateLimited = true;
		}
	} catch (error) {
		console.error('Failed to load wiki posts', error);
	}

	const payload: CachedPayload = {
		githubStats: { stars, forks, contributors: orgMembers },
		repoStats,
		orgRepos,
		memberRepos,
		orgMembers: orgMembersList,
		memberDetails,
		blogPosts
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

	if (d1) {
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
