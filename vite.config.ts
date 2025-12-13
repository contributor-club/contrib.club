import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [tailwindcss(), sveltekit()] });
//You can also disable this overlay by setting server.hmr.overlay to false in vite.config.ts.
//See https://vitejs.dev/config/#server-hmr-overlay for more information.
server: {
    hmr: {
        overlay: false
    }
}
