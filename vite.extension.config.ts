import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Browser-extension build (Chromium MV3 / Firefox WebExtensions).
 *
 *   npm run build:ext   -> extension/dist  (load THIS folder as "unpacked")
 *   npm run watch:ext   -> rebuilds on change (reload the extension in chrome://extensions)
 *
 * Reuses the web app's tools (src/tools/*), theme tokens and CSS. `extension/public/*`
 * (manifest.json, background.js, icons, theme-boot.js) is copied verbatim into the bundle.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./extension/app'),
  base: './',
  publicDir: here('./extension/public'),
  plugins: [react()],
  build: {
    outDir: here('./extension/dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: here('./extension/app/popup.html'),
        sidepanel: here('./extension/app/sidepanel.html'),
      },
    },
  },
});
