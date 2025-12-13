// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			// Cloudflare Workers bindings (see https://developers.cloudflare.com/workers/configuration/environment-variables/)
			env?: {
				GITHUB_TOKEN?: string;
			};
		}
	}
}

export {};
