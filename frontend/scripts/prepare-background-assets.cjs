// Build-time only. The installed application never downloads a model or contacts a model host.
/* eslint-disable @typescript-eslint/no-require-imports -- Node build tooling uses CommonJS. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { unzipSync } = require('fflate');
const root = path.resolve(__dirname, '..');
const manifest = require('../background-model.json');
const output = path.join(root, 'public/background-model');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const valid = () => Object.entries(manifest.files).every(([name, sha]) => {
 const file = path.join(output, name);
 return fs.existsSync(file) && digest(fs.readFileSync(file)) === sha;
});
(async () => {
 fs.mkdirSync(output, { recursive: true });
 if (!valid()) {
  const response = await fetch(manifest.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('Background model download failed: ' + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (digest(bytes) !== manifest.sha256) throw new Error('Background model archive checksum mismatch');
  const files = unzipSync(bytes, { filter: file => Object.keys(manifest.files).some(name => file.name === 'ffnet_40s-onnx-w8a8/' + name) });
  for (const [name, sha] of Object.entries(manifest.files)) {
   const value = files['ffnet_40s-onnx-w8a8/' + name];
   if (!value || digest(value) !== sha) throw new Error('Background model checksum mismatch: ' + name);
   fs.writeFileSync(path.join(output, name), value);
  }
 }
 const runtime = path.join(root, 'public/background-runtime');
 fs.mkdirSync(runtime, { recursive: true });
 for (const name of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  fs.copyFileSync(path.join(root, 'node_modules/onnxruntime-web/dist', name), path.join(runtime, name));
 }
 const license = path.join(root, '../desktop/licenses/ONNX-RUNTIME.txt');
 fs.copyFileSync(license, path.join(runtime, 'LICENSE.txt'));
 console.log('Offline background model verified; ONNX runtime staged.');
})().catch(error => { console.error(error); process.exitCode = 1; });
