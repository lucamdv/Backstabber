import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('..', import.meta.url));
const assets = ['images', 'css', 'background.mp4', 'background_mobile.mp4'];

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'backstabber-assets',
    configureServer(server) {
      // Serve the original files during dev. Vite handles range requests for video.
      server.middlewares.use((req, _res, next) => {
        if (assets.some(asset => req.url?.split('?')[0].split('/')[1] === asset)) {
          req.url = '/@fs/' + resolve(root, '.' + req.url).replaceAll('\\', '/');
        }
        next();
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      for (const asset of assets) {
        const source = resolve(root, asset);
        if (existsSync(source)) cpSync(source, resolve(options.dir, asset), { recursive: true });
      }
    },
  }],
  server: { fs: { allow: [root] }, proxy: { '/api/v1': 'http://127.0.0.1:8787' } },
  test: { environment: 'jsdom', setupFiles: ['./src/tests/setup.ts'] },
});
