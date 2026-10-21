const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), out = path.join(root, 'pwa/build');
const version = JSON.parse(fs.readFileSync(path.join(root, 'desktop/package.json'))).version;
function run(script, args = []) { execFileSync(process.execPath, [path.join(root, script), ...args], { cwd: root, stdio: 'inherit', windowsHide: true }); }
function copyTree(source, target) {
  if (process.platform !== 'win32') return fs.cpSync(source, target, { recursive: true });
  try { execFileSync('robocopy', [source, target, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'ignore', windowsHide: true }); }
  catch (error) { if (error.status > 7 || error.status === null) throw error; }
}
async function main() {
  run('frontend/scripts/prepare-background-assets.cjs'); run('frontend/scripts/prepare-star-assets.cjs');
  run('frontend/node_modules/vite/bin/vite.js', ['build', '--config', 'pwa/vite.config.mts', '--configLoader', 'runner']);
  run('android/scripts/prepare-model.cjs');
  copyTree(path.join(root, 'frontend/public'), out);
  copyTree(path.join(root, 'android/build/mobile-model'), path.join(out, 'mobile-model'));
  for (const folder of ['desktop/licenses', 'android/licenses']) copyTree(path.join(root, folder), path.join(out, 'licenses'));
  fs.copyFileSync(path.join(root, 'desktop/NOTICE.txt'), path.join(out, 'NOTICE.txt'));
  const renderer = path.join(out, 'stellarium/stellarium-web-engine.js');
  fs.writeFileSync(renderer, require('../../android/scripts/prepare-renderer.cjs').optimizeRenderer(fs.readFileSync(renderer, 'utf8')));
  const vector = fs.readFileSync(path.join(root, 'android/app/src/main/res/drawable/app_icon.xml'), 'utf8');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">' + [...vector.matchAll(/<path android:fillColor="([^"]+)" android:pathData="([^"]+)"\/>/g)].map(m => `<path fill="${m[1]}" d="${m[2]}"/>`).join('') + '</svg>';
  const sharp = require('../../frontend/node_modules/sharp'); fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  for (const size of [192, 512]) await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(out, `icons/icon-${size}.png`));
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({ id: '/', name: 'AstroSky', short_name: 'AstroSky', lang: 'ko', description: '천체 관측과 촬영을 돕는 연구 앱', start_url: '/', scope: '/', display: 'standalone', background_color: '#071426', theme_color: '#071426', icons: [192, 512].map(size => ({ src: `/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })) }));
  const files = [], large = {};
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name); if (entry.isDirectory()) { walk(file); continue; }
      if (['BUILD.json', 'catalogue.json', 'favicon.ico'].includes(entry.name) || /\.(?:tsv|map)$/.test(file)) { fs.unlinkSync(file); continue; }
      const data = fs.readFileSync(file), url = '/' + path.relative(out, file).replaceAll('\\', '/');
      files.push({ url, bytes: data.length, hash: crypto.createHash('sha256').update(data).digest('hex') });
      if (data.length > 24 * 1024 * 1024) {
        if (url !== '/background-model/ffnet_40s.data') throw Error('Review large asset: ' + url);
        const parts = []; fs.mkdirSync(path.join(out, 'chunks'), { recursive: true });
        for (let offset = 0, index = 0; offset < data.length; offset += 24 * 1024 * 1024, index++) {
          const part = `/chunks/ffnet-${index}.bin`; fs.writeFileSync(path.join(out, part), data.subarray(offset, offset + 24 * 1024 * 1024)); parts.push(part);
        }
        large[url] = { bytes: data.length, parts }; fs.unlinkSync(file);
      }
    }
  }
  walk(out);
  // Chunks are transparent network transport, not duplicate offline assets.
  const manifestFiles = files.filter(f => !f.url.startsWith('/chunks/'));
  fs.writeFileSync(path.join(out, 'large-assets.json'), JSON.stringify(large));
  fs.writeFileSync(path.join(out, 'offline-assets.json'), JSON.stringify({ version, bytes: manifestFiles.reduce((n, f) => n + f.bytes, 0), files: manifestFiles }));
  const shell = manifestFiles.filter(f => f.url === '/index.html' || f.url.startsWith('/assets/') || f.url.startsWith('/icons/') || f.url === '/manifest.webmanifest').map(f => f.url);
  fs.writeFileSync(path.join(out, 'sw.js'), fs.readFileSync(path.join(root, 'pwa/sw.js'), 'utf8').replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(shell)));
  fs.writeFileSync(path.join(out, '_headers'), '/sw.js\n  Cache-Control: no-cache\n/offline-assets.json\n  Cache-Control: no-store\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n');
  console.log(JSON.stringify({ version, files: manifestFiles.length, offlineBytes: manifestFiles.reduce((n, f) => n + f.bytes, 0), chunked: Object.keys(large), output: out }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
