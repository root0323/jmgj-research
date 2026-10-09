const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = async ({ appOutDir }) => {
  const resources = path.join(appOutDir, 'resources');
  // electron-builder excludes a root node_modules in ordinary extraResources.
  // The Next standalone runtime must be copied by its own explicit matcher.
  for (const required of ['web/node_modules/next/package.json', 'web/node_modules/next/dist/server/lib/start-server.js',
    'web/desktop-server.cjs', 'web/.next-desktop/BUILD_ID', 'web/public/stellarium/stellarium-web-engine.wasm',
    'web/public/stellarium/landscapes/guereins/properties',
    'web/public/background-sw.js', 'web/public/background/worker.js',
    'web/public/background-model/ffnet_40s.onnx', 'web/public/background-model/ffnet_40s.data',
    'web/public/background-runtime/ort-wasm-simd-threaded.wasm',
    'web/public/background-runtime/ort.wasm.min.mjs', 'web/public/background-runtime/ort-wasm-simd-threaded.mjs',
    'web/public/background/math.js', 'licenses/FFNET.txt', 'licenses/ONNX-RUNTIME.txt', 'licenses/ONNX-THIRD-PARTY.txt',
    'backend/jmgj-backend.exe', 'backend/jmgj-backend.pkg', 'backend/_internal/python312.dll']) {
    if (!fs.existsSync(path.join(resources, required))) throw new Error('Incomplete desktop runtime: ' + required);
  }
  const model = JSON.parse(fs.readFileSync(path.join(__dirname, '../../frontend/background-model.json'), 'utf8'));
  for (const [name, hash] of Object.entries(model.files)) {
    const bytes = fs.readFileSync(path.join(resources, 'web/public/background-model', name));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash) {
      throw new Error('Corrupt bundled sky segmentation model: ' + name);
    }
  }
  for (let tile = 0; tile < 12; tile++) {
    if (!fs.existsSync(path.join(resources, `web/public/stellarium/landscapes/guereins/Norder0/Dir0/Npix${tile}.webp`))) {
      throw new Error('Incomplete bundled natural landscape');
    }
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
