const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { zipSync } = require('../../frontend/node_modules/fflate');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'android/build/mobile-model');
const base = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/';
async function download(name, hash) {
  const target = path.join(out, 'pyodide', name);
  if (fs.existsSync(target) && (!hash || crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') === hash)) return;
  const response = await fetch(base + name); if (!response.ok) throw Error('Pyodide download failed: ' + name);
  const data = Buffer.from(await response.arrayBuffer());
  if (hash && crypto.createHash('sha256').update(data).digest('hex') !== hash) throw Error('Package hash mismatch: ' + name);
  fs.writeFileSync(target, data);
}
async function main() {
  fs.mkdirSync(path.join(out, 'pyodide'), { recursive: true });
  const rasterScript = path.join(out, 'geotiff.js');
  const rasterHash = 'cb5c9731bfee1f8bff1728e54e4436ada81ea3258b178a3d6603c61b58d99e6c';
  if (!fs.existsSync(rasterScript) || crypto.createHash('sha256').update(fs.readFileSync(rasterScript)).digest('hex') !== rasterHash) {
    const response = await fetch('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js');
    if (!response.ok) throw Error('DEM decoder unavailable');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== rasterHash) throw Error('DEM decoder hash mismatch');
    fs.writeFileSync(rasterScript, bytes);
  }
  for (const name of ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) await download(name);
  const lock = JSON.parse(fs.readFileSync(path.join(out, 'pyodide/pyodide-lock.json')));
  const names = new Set();
  function include(name) { name = name.toLowerCase().replaceAll('_', '-'); if (names.has(name)) return; const pkg = lock.packages[name]; if (!pkg) throw Error('Missing package: ' + name); names.add(name); for (const dep of pkg.depends) include(dep); }
  ['numpy', 'rasterio', 'h5py', 'fastapi', 'httpx', 'requests', 'sqlite3'].forEach(include);
  for (const name of names) { const pkg = lock.packages[name]; await download(pkg.file_name, pkg.sha256); }
  const files = {};
  function pythonTree(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || entry.name === 'data') continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) pythonTree(file);
      else if (entry.name.endsWith('.py')) files['backend/src/' + path.relative(path.join(root, 'backend/src'), file).replaceAll('\\', '/')] = new Uint8Array(fs.readFileSync(file));
    }
  }
  pythonTree(path.join(root, 'backend/src/app'));
  files['backend/src/mobile.py'] = new Uint8Array(fs.readFileSync(path.join(root, 'android/model/mobile.py')));
  const catalog = path.join(out, 'catalogue.json');
  const catalogueHash = 'f44bfe74a6961dca6fcf9dd76eaf5521a24287ac404821fdac6b7540dcc069b2';
  if (!fs.existsSync(catalog) || crypto.createHash('sha256').update(fs.readFileSync(catalog)).digest('hex') !== catalogueHash) {
    const response = await fetch('https://astrosky-black-marble.jmgj-kakao-search.workers.dev/VJ146A4-2025/index.json');
    if (!response.ok) throw Error('Pinned Black Marble catalogue unavailable');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== catalogueHash) throw Error('Pinned catalogue hash mismatch');
    fs.writeFileSync(catalog, bytes);
  }
  const catalogue = JSON.parse(fs.readFileSync(catalog));
  if (Object.keys(catalogue.tiles).length !== 540 || catalogue.year !== 2025) throw Error('Verified catalogue required');
  files['catalogue.json'] = new Uint8Array(fs.readFileSync(catalog));
  fs.writeFileSync(path.join(out, 'model.zip'), zipSync(files, { level: 6 }));
  fs.copyFileSync(path.join(root, 'android/model/worker.js'), path.join(out, 'worker.js'));
  fs.copyFileSync(path.join(root, 'android/model/dem.js'), path.join(out, 'dem.js'));
  fs.writeFileSync(path.join(out, 'BUILD.json'), JSON.stringify({ pyodide: '0.29.3', packages: [...names].map(name => ({ name, ...lock.packages[name] })), pythonFiles: Object.keys(files), sourceHashes: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, crypto.createHash('sha256').update(content).digest('hex')])) }, null, 2));
  console.log(JSON.stringify({ packages: names.size, pythonFiles: Object.keys(files).length, folder: out }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
