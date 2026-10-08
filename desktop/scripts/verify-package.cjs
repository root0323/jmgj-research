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
};
