import type { RequestHandler } from '@sveltejs/kit';

type Env = {
	CACHE_DB?: any;
};

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
		await db
			.prepare(
				'CREATE TABLE IF NOT EXISTS contact_requests (id TEXT PRIMARY KEY, name TEXT, email TEXT, github_url TEXT, created_at INTEGER)'
			)
			.run();

		const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
		const createdAt = Date.now();

		await db
			.prepare(
				'INSERT INTO contact_requests (id, name, email, github_url, created_at) VALUES (?, ?, ?, ?, ?)'
			)
			.bind(id, name, email, github, createdAt)
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
