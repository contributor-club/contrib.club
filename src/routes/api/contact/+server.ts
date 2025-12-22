import type { RequestHandler } from '@sveltejs/kit';

type Env = {
	CACHE_DB?: any;
};

function normalizeGithub(value: string): { username: string; url: string } | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const cleaned = trimmed.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/^@/, '');
	const username = cleaned.split(/[/?#]/)[0]?.trim();
	if (!username) return null;

	const normalizedUsername = username.toLowerCase();
	return {
		username: normalizedUsername,
		url: `https://github.com/${normalizedUsername}`
	};
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const cfEnv = platform?.env as Env | undefined;
	const db = cfEnv?.CACHE_DB;

	if (!db) {
		return new Response(
			JSON.stringify({ error: 'Database unavailable. Please try again later.' }),
			{ status: 503, headers: { 'content-type': 'application/json' } }
		);
	}

	let payload: { name?: string; email?: string; github?: string };
	try {
		payload = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	const name = payload.name?.trim();
	const email = payload.email?.trim();
	const github = payload.github?.trim();

	if (!name || !email || !github) {
		return new Response(JSON.stringify({ error: 'Name, email, and GitHub URL are required.' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	try {
		const normalizedGithub = normalizeGithub(github);
		if (!normalizedGithub) {
			return new Response(JSON.stringify({ error: 'The GitHub username is invalid.' }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}

		const normalizedEmail = email.toLowerCase();
		const normalizedGithubUrl = normalizedGithub.url.toLowerCase();

		await db
			.prepare(
				'CREATE TABLE IF NOT EXISTS contact_requests (id TEXT PRIMARY KEY, name TEXT, email TEXT, github_url TEXT, created_at INTEGER)'
			)
			.run();

		const duplicate = await db
			.prepare(
				'SELECT id FROM contact_requests WHERE lower(email) = ? OR lower(github_url) = ? OR lower(github_url) = ? LIMIT 1'
			)
			.bind(normalizedEmail, normalizedGithubUrl, `${normalizedGithubUrl}/`)
			.first();

		if (duplicate) {
			return new Response(
				JSON.stringify({
					error: 'We already received your request. Hang tight—we will be in touch soon.'
				}),
				{
					status: 409,
					headers: { 'content-type': 'application/json' }
				}
			);
		}

		const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
		const createdAt = Date.now();

		await db
			.prepare(
				'INSERT INTO contact_requests (id, name, email, github_url, created_at) VALUES (?, ?, ?, ?, ?)'
			)
			.bind(id, name, email, normalizedGithub.url, createdAt)
			.run();

		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	} catch (error) {
		console.error('Failed to store contact request', error);
		return new Response(JSON.stringify({ error: 'Could not save request.' }), {
			status: 500,
			headers: { 'content-type': 'application/json' }
		});
	}
};
