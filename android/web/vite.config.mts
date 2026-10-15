import { defineConfig } from '../../frontend/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  publicDir: false,
  resolve: { alias: { '@': frontend, 'react': `${frontend}node_modules/react`, 'react-dom': `${frontend}node_modules/react-dom` } },
  esbuild: { jsx: 'automatic' },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_SKY_BRIGHTNESS_BASE_URL': '"/api/difficulty"' },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
