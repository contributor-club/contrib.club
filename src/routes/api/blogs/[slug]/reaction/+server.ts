import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type Env = {
	CACHE_DB?: any;
};

type DbBlogRow = {
	slug?: string;
	reactions?: string | null;
};

type ReactionRecord = { emoji: string; ts: number; deviceId?: string; ip?: string };
type ReactionState = {
	counts: Record<string, number>;
	ipMap: Record<string, ReactionRecord>;
};

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

function parseReactionState(raw: string | null | undefined): ReactionState {
	if (!raw) return { counts: {}, ipMap: {} };
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object') {
			const counts =
				'counts' in parsed
					? normalizeReactionCounts((parsed as any).counts)
					: normalizeReactionCounts(parsed);
			const ipMap =
				'ipMap' in parsed && parsed.ipMap && typeof parsed.ipMap === 'object'
					? Object.entries(parsed.ipMap as Record<string, any>).reduce((acc, [key, value]) => {
							if (!key) return acc;
							if (typeof value === 'string') {
								acc[key] = { emoji: value, ts: 0 };
							} else if (value && typeof value === 'object' && 'emoji' in value) {
								acc[key] = {
									emoji: String((value as any).emoji),
									ts: Number((value as any).ts) || 0,
									deviceId: (value as any).deviceId ? String((value as any).deviceId) : undefined,
									ip: (value as any).ip ? String((value as any).ip) : undefined
								};
							}
							return acc;
						}, {} as Record<string, ReactionRecord>)
					: {};
			return { counts, ipMap };
		}
		if (Array.isArray(parsed)) {
			const counts = parsed.reduce((acc, emoji) => {
				const key = String(emoji);
				acc[key] = (acc[key] ?? 0) + 1;
				return acc;
			}, {} as Record<string, number>);
			return { counts, ipMap: {} };
		}
	} catch {
		return { counts: {}, ipMap: {} };
	}
	return { counts: {}, ipMap: {} };
}

async function sha256(text: string) {
	const data = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function clientIp(event: Parameters<RequestHandler>[0]): string | null {
	const addr = (event.getClientAddress && event.getClientAddress()) || null;
	if (addr) return addr;
	const forwarded =
		event.request.headers.get('cf-connecting-ip') ||
		event.request.headers.get('x-forwarded-for') ||
		event.request.headers.get('x-real-ip');
	return forwarded?.split(',')[0]?.trim() || null;
}

const MAX_EMOJI_LENGTH = 8;
const COOLDOWN_MS = 3000;

export const POST: RequestHandler = async (event) => {
	const slug = event.params.slug;
	const cfEnv = (event.platform?.env as Env | undefined) ?? undefined;
	const d1 = cfEnv?.CACHE_DB;

	if (!d1) {
		throw error(500, 'Reactions unavailable (database not configured)');
	}

	const body = await event.request.json().catch(() => null);
	const emoji = typeof body?.emoji === 'string' ? body.emoji.trim() : '';
	if (!emoji || emoji.length > MAX_EMOJI_LENGTH) {
		throw error(400, 'Invalid reaction');
	}

	const ip = clientIp(event);
	if (!ip) {
		throw error(400, 'Could not determine client');
	}
	const ipHash = await sha256(ip);
	const actorKey = ipHash;

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
		.prepare('SELECT reactions FROM blogs WHERE slug = ?')
		.bind(slug)
		.first()) as DbBlogRow | null;

	if (!row) {
		throw error(404, 'Blog not found');
	}

	const state = parseReactionState(row.reactions);

	const now = Date.now();
	const existing = state.ipMap[actorKey];
	if (existing && existing.emoji !== emoji && now - existing.ts < COOLDOWN_MS) {
		return json(
			{
				counts: state.counts,
				userReaction: existing.emoji,
				limited: true,
				message: 'Please wait a moment before changing your reaction.'
			},
			{ status: 429 }
		);
	}

	// Toggle off if clicking the same emoji
	if (existing?.emoji === emoji) {
		state.counts[emoji] = Math.max(0, (state.counts[emoji] ?? 1) - 1);
		delete state.ipMap[actorKey];
		try {
			await d1
				.prepare('UPDATE blogs SET reactions = ?, modified_at = CURRENT_TIMESTAMP WHERE slug = ?')
				.bind(JSON.stringify(state), slug)
				.run();
		} catch (err) {
			console.error('Failed to update reactions', err);
			throw error(500, 'Failed to record reaction');
		}
		return json({ counts: state.counts, userReaction: null });
	}

	// Switch reaction (or add new)
	if (existing?.emoji && existing.emoji !== emoji) {
		const prev = existing.emoji;
		state.counts[prev] = Math.max(0, (state.counts[prev] ?? 1) - 1);
	}

	state.counts[emoji] = (state.counts[emoji] ?? 0) + 1;
	state.ipMap[actorKey] = { emoji, ts: now, ip: ipHash };

	try {
		await d1
			.prepare('UPDATE blogs SET reactions = ?, modified_at = CURRENT_TIMESTAMP WHERE slug = ?')
			.bind(JSON.stringify(state), slug)
			.run();
	} catch (err) {
		console.error('Failed to update reactions', err);
		throw error(500, 'Failed to record reaction');
	}

	return json({ counts: state.counts, userReaction: emoji });
};

export const GET: RequestHandler = async (event) => {
	const slug = event.params.slug;
	const cfEnv = (event.platform?.env as Env | undefined) ?? undefined;
	const d1 = cfEnv?.CACHE_DB;

	if (!d1) {
		throw error(500, 'Reactions unavailable (database not configured)');
	}

	const ip = clientIp(event);
	const ipHash = ip ? await sha256(ip) : null;

	await d1
		.prepare(
			'CREATE TABLE IF NOT EXISTS blogs (slug TEXT PRIMARY KEY, title TEXT, description TEXT, content TEXT, author TEXT, created_at TEXT, modified_at TEXT, reactions TEXT)'
		)
		.run();

	const row = (await d1
		.prepare('SELECT reactions FROM blogs WHERE slug = ?')
		.bind(slug)
		.first()) as DbBlogRow | null;

	if (!row) {
		throw error(404, 'Blog not found');
	}

	const state = parseReactionState(row.reactions);
	const userReaction = ipHash ? state.ipMap[ipHash]?.emoji ?? null : null;

	return json({ counts: state.counts, userReaction });
};
