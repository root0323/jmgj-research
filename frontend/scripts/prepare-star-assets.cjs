/* Pinned, verified Stellarium catalogue; works offline and avoids a retired server. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../data/stellarium-stars-manifest.json');
const out = path.resolve(__dirname, '../public/stellarium/skydata/stars');
async function main() {
  let index = 0;
  async function download() {
    while (index < manifest.files.length) {
      const file = manifest.files[index++];
      if (!/^(properties|Norder[01]\/Dir0\/Npix\d+\.eph)$/.test(file.path)) throw Error('Invalid star asset path');
      const dest = path.join(out, file.path);
      const verify = bytes => bytes.length === file.bytes && crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex') === file.sha;
      if (fs.existsSync(dest) && verify(fs.readFileSync(dest))) continue;
      const response = await fetch('https://raw.githubusercontent.com/Stellarium/stellarium-web-engine/' + manifest.commit + '/apps/test-skydata/stars/' + file.path);
      if (!response.ok) throw Error('Star catalogue unavailable: ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!verify(bytes)) throw Error('Star catalogue hash mismatch');
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes);
    }
  }
  await Promise.all([download(), download(), download(), download()]);
  console.log('Verified offline Stellarium catalogue: ' + manifest.files.length + ' files');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
