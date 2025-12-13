import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

type Env = {
	CACHE_DB?: any;
	GITHUB_TOKEN?: string;
};

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
			if ('counts' in parsed) return normalizeReactionCounts((parsed as any).counts);
			return normalizeReactionCounts(parsed);
		}
	} catch {
		return {};
	}
	return {};
}

function mapDbBlog(row: DbBlogRow): BlogEntry | null {
	if (!row?.slug || !row.title) return null;
	const reactions = parseReactions(row.reactions);
	const createdAt = row.created_at ?? new Date().toISOString();
	return {
		slug: row.slug,
		title: row.title,
		description: row.description ?? '',
		content: row.content ?? '',
		author: row.author ?? 'contributor-club',
		authorUrl: row.author_url ?? null,
		createdAt,
		modifiedAt: row.modified_at ?? createdAt,
		reactions
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

async function fetchWikiFallback(slug: string, headers: Record<string, string>): Promise<BlogEntry | null> {
	const wikiOwner = 'contributor-club';
	const wikiRepo = 'contrib.club.wiki';
	const rawUrl = `https://raw.githubusercontent.com/${wikiOwner}/${wikiRepo}/master/${encodeURIComponent(slug)}.md`;

	let content = '';
	try {
		const res = await fetch(rawUrl, { headers });
		if (!res.ok) return null;
		content = await res.text();
	} catch {
		return null;
	}

	let createdAt = new Date().toISOString();
	try {
		const commitRes = await fetch(
			`https://api.github.com/repos/${wikiOwner}/${wikiRepo}/commits?path=${encodeURIComponent(slug)}.md&per_page=1`,
			{ headers }
		);
		if (commitRes.ok) {
			const commits: { commit: { committer?: { date?: string }; author?: { date?: string } } }[] =
				await commitRes.json();
			createdAt =
				commits[0]?.commit?.committer?.date ?? commits[0]?.commit?.author?.date ?? createdAt;
		}
	} catch {
		// ignore commit date failures
	}

	const lines = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const heading = lines.find((line) => line.startsWith('#'))?.replace(/^#+\s*/, '');
	const bodyLine = lines.find((line) => !line.startsWith('#'));
	const title = heading || slug.replace(/-/g, ' ') || 'Blog post';
	const description = bodyLine || heading || 'Read more from Contrib.Club.';

	return {
		slug,
		title,
		description,
		content,
		author: 'contributor-club',
		authorUrl: null,
		createdAt,
		modifiedAt: createdAt,
		reactions: {}
	};
}

export const load: PageServerLoad = async ({ params, platform }) => {
	const slug = params.slug;
	const cfEnv = (platform?.env as Env | undefined) ?? undefined;
	const githubToken =
		cfEnv?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? (import.meta as any)?.env?.GITHUB_TOKEN;
	const baseHeaders: Record<string, string> = {
		accept: 'application/vnd.github+json',
		'user-agent': 'contrib-club-worker/1.0 (+https://contrib.club)'
	};
	const headers = githubToken
		? { ...baseHeaders, authorization: `token ${githubToken}` }
		: baseHeaders;

	const d1 = cfEnv?.CACHE_DB;
	let blog: BlogEntry | null = null;

	if (d1) {
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
	const row = (await d1
		.prepare(
			'SELECT slug, title, description, content, author, author_url, created_at, modified_at, reactions FROM blogs WHERE slug = ?'
		)
		.bind(slug)
		.first()) as DbBlogRow | null;
			blog = mapDbBlog(row ?? {});
		} catch (err) {
			console.error('Failed to fetch blog from D1', err);
		}
	}

	if (!blog) {
		blog = await fetchWikiFallback(slug, headers);
	}

	if (!blog) {
		throw error(404, 'Blog post not found');
	}

	const authorSite = await fetchAuthorWebsite(blog.author, headers);
	blog = { ...blog, authorUrl: authorSite ?? blog.authorUrl ?? null };

	return { blog };
};
