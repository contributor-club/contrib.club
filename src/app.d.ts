// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// Cloudflare Worker bindings (see https://developers.cloudflare.com/workers/configuration/environment-variables/)
		interface Platform {
			env?: {
				/**
				 * Injected from wrangler secrets/vars (wrangler.jsonc / dashboard).
				 */
				GITHUB_TOKEN?: string;
				CACHE_DB?: D1Database;
			};
		}
	}
}

// Minimal D1 types to satisfy the adapter in this repo
interface D1PreparedStatement<T = unknown> {
	bind(...values: unknown[]): D1PreparedStatement<T>;
	first<R = Record<string, unknown>>(): Promise<R | null>;
	all<R = Record<string, unknown>>(): Promise<{ results: R[] }>;
	run(): Promise<T>;
}

declare interface D1Database {
	prepare<T = unknown>(query: string): D1PreparedStatement<T>;
}

export {};
