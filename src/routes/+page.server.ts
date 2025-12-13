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

export const load: PageServerLoad = async ({ fetch, platform }) => {
	const githubToken = platform?.env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
	const acceptTopics = 'application/vnd.github+json, application/vnd.github.mercy-preview+json';
	const headers: Record<string, string> = {
		accept: acceptTopics,
		...(githubToken ? { authorization: `Bearer ${githubToken}` } : {})
	};
	const publicHeaders = { accept: acceptTopics };

	const org = 'contributor-club';

	let stars = 0;
	let forks = 0;
	const repoStats: Record<string, { stars: number; forks: number; activity?: number[] }> = {};
	let orgMembers = 0;
	let orgMembersList: { login: string; avatar_url: string; html_url: string }[] = [];
	let orgRepos: OrgRepo[] = [];
	let memberRepos: OrgRepo[] = [];

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

	return {
		githubStats: { stars, forks, contributors: orgMembers },
		repoStats,
		orgRepos,
		memberRepos,
		orgMembers: orgMembersList
	};
};
