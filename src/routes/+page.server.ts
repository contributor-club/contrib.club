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

export const load: PageServerLoad = async ({ fetch, platform }) => {
	const githubToken = platform?.env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
	const headers: Record<string, string> = {
		accept: 'application/vnd.github+json',
		...(githubToken ? { authorization: `Bearer ${githubToken}` } : {})
	};
	const publicHeaders = { accept: 'application/vnd.github+json' };

	const org = 'contributor-club';

	let stars = 0;
	let forks = 0;
	const repoStats: Record<string, { stars: number; forks: number }> = {};
	let orgMembers = 0;
	let orgMembersList: { login: string; avatar_url: string; html_url: string }[] = [];
	let orgRepos: OrgRepo[] = [];

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
			try {
				const reposRes = await fetch(url, { headers: publicHeaders });
				if (!reposRes.ok) continue;
				const reposData: OrgRepo[] = await reposRes.json();
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
				if (orgRepos.length > 0) break;
			} catch (error) {
				console.error('Failed to load repos from', url, error);
			}
		}
	} catch (error) {
		console.error('Failed to load org repositories', error);
	}

	return {
		githubStats: { stars, forks, contributors: orgMembers },
		repoStats,
		orgRepos,
		orgMembers: orgMembersList
	};
};
