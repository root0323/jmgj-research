import { defineConfig } from '../frontend/node_modules/vitest/dist/config.js';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('./', import.meta.url)), resolve: { alias: { '@': fileURLToPath(new URL('../frontend/', import.meta.url)) } }, test: { include: ['src/*.test.ts'], pool: 'threads' } });
