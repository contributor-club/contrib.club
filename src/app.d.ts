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
			};
		}
	}
}

export {};
