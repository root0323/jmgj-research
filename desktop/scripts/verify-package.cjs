const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ appOutDir }) => {
  const resources = path.join(appOutDir, 'resources');
  // electron-builder excludes a root node_modules in ordinary extraResources.
  // The Next standalone runtime must be copied by its own explicit matcher.
  for (const required of ['web/node_modules/next/package.json', 'web/node_modules/next/dist/server/lib/start-server.js',
    'web/desktop-server.cjs', 'web/.next-desktop/BUILD_ID', 'web/public/stellarium/stellarium-web-engine.wasm',
    'backend/jmgj-backend.exe', 'backend/jmgj-backend.pkg', 'backend/_internal/python312.dll']) {
    if (!fs.existsSync(path.join(resources, required))) throw new Error('Incomplete desktop runtime: ' + required);
  }
  const root = path.join(resources, 'data/black-marble/VJ146A4-2025');
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  if (index.product !== 'VJ146A4' || index.year !== 2025 || Object.keys(index.tiles).length !== 540) {
    throw new Error('Incomplete bundled Black Marble dataset');
  }
  for (const [tile, item] of Object.entries(index.tiles)) {
    if (!/^VJ146A4\.A2025001\.h\d{2}v\d{2}\.002\.\d{13}\.h5$/.test(item.file) ||
      !item.file.includes('.' + tile + '.') || fs.statSync(path.join(root, 'compact', item.file)).size !== item.compactBytes) {
      throw new Error('Missing/corrupt bundled Black Marble tile: ' + tile);
    }
  }
};
