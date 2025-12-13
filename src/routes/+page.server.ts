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

type Env = {
	GITHUB_TOKEN?: string;
};

export const load: PageServerLoad = async ({ fetch, platform }) => {
	// Cloudflare Worker secret is exposed via platform.env; fall back to process/import.meta for local dev
	const cfEnv = (platform?.env as Env | undefined) ?? undefined;
	const githubToken =
		cfEnv?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? (import.meta as any)?.env?.GITHUB_TOKEN;
	const acceptTopics = 'application/vnd.github+json, application/vnd.github.mercy-preview+json';
	const headers: Record<string, string> = {
		accept: acceptTopics,
		...(githubToken ? { authorization: `Bearer ${githubToken}` } : {})
	};
	const publicHeaders = { accept: acceptTopics };

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
	let orgRepos: OrgRepo[] = [];
	let memberRepos: OrgRepo[] = [];
	let blogPosts: { title: string; excerpt: string; date?: string; url: string }[] = [];

	try {
		const membersRes = await fetch(`https://api.github.com/orgs/${org}/members?per_page=100`, { headers });
		if (membersRes.ok) {
			const members: { login: string; avatar_url: string; html_url: string }[] = await membersRes.json();
			orgMembers = members.length;
			orgMembersList = members;
		}
	} catch (error) {
		console.error('Failed to load org members', error);
	}

	// Fallback to public members if private members are hidden or token missing
	if (orgMembersList.length === 0) {
		try {
			const publicMembersRes = await fetch(
				`https://api.github.com/orgs/${org}/public_members?per_page=100`,
				{ headers: { accept: 'application/vnd.github+json' } }
			);
			if (publicMembersRes.ok) {
				const publicMembers: { login: string; avatar_url: string; html_url: string }[] =
					await publicMembersRes.json();
				orgMembers = publicMembers.length;
				orgMembersList = publicMembers;
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

		for (const url of repoUrls) {
			const headerSet = githubToken ? headers : publicHeaders;
			try {
				const reposRes = await fetch(url, { headers: headerSet });
				if (!reposRes.ok) {
					console.error('Repo fetch failed', url, reposRes.status, await reposRes.text());
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
					updated_at: repo.updated_at
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
				break;
			} catch (error) {
				console.error('Failed to load repos from', url, error);
			}
		}
	} catch (error) {
		console.error('Failed to load org repositories', error);
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
			memberRepos = Array.from(
				new Map(memberRepoResults.flat().map((repo) => [repo.html_url, repo])).values()
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

	// Fetch commit activity (last year) for all repos we know about
	const allRepoUrls = Array.from(
		new Set(
			[...orgRepos, ...memberRepos]
				.map((repo) => repo.html_url)
				.filter((url): url is string => Boolean(url))
		)
	);

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

					return { title, excerpt, date: latestDate, url };
				})
			);

			blogPosts = posts
				.filter(Boolean)
				.sort((a, b) => {
					const aDate = a.date ? new Date(a.date).getTime() : 0;
					const bDate = b.date ? new Date(b.date).getTime() : 0;
					return bDate - aDate;
				});
		}
	} catch (error) {
		console.error('Failed to load wiki posts', error);
	}

	return {
		githubStats: { stars, forks, contributors: orgMembers },
		repoStats,
		orgRepos,
		memberRepos,
		orgMembers: orgMembersList,
		blogPosts
	};
};
