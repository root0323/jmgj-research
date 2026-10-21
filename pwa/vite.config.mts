import { defineConfig } from '../frontend/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));
const version = JSON.parse(fs.readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')).version;
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)), publicDir: false,
  resolve: { alias: [
    { find: /^\.\/UpdateWindow$/, replacement: fileURLToPath(new URL('./src/UpdateWindow.tsx', import.meta.url)) },
    { find: '@', replacement: frontend },
    { find: 'react', replacement: `${frontend}node_modules/react` },
    { find: 'react-dom', replacement: `${frontend}node_modules/react-dom` },
  ] },
  esbuild: { jsx: 'automatic' },
  define: { __APP_VERSION__: JSON.stringify(version), 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_SKY_BRIGHTNESS_BASE_URL': '"/api/difficulty"' },
  build: { target: 'es2022', outDir: 'build', emptyOutDir: true },
});
