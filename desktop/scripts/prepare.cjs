const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const desktop = path.resolve(__dirname, '..');
const repo = path.dirname(desktop);
const frontend = path.join(repo, 'frontend');
const python = process.env.JMGJ_BUILD_PYTHON || path.join(repo, '.venv/Scripts/python.exe');
function run(command, args, cwd, extra = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...extra }, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Build step failed: ' + command);
}
run(python, ['desktop/prepare_data.py'], repo);
run(process.execPath, [path.join(frontend, 'node_modules/next/dist/bin/next'), 'build'], frontend,
  { JMGJ_DESKTOP_BUILD: '1', NEXT_TELEMETRY_DISABLED: '1' });
const destination = path.join(desktop, 'build/web');
fs.mkdirSync(destination, { recursive: true });
const filter = (source) => !path.basename(source).startsWith('.env');
fs.cpSync(path.join(frontend, '.next-desktop/standalone'), destination, { recursive: true, filter });
fs.cpSync(path.join(frontend, '.next-desktop/static'), path.join(destination, '.next-desktop/static'), { recursive: true });
fs.cpSync(path.join(frontend, 'public'), path.join(destination, 'public'), { recursive: true });
fs.writeFileSync(path.join(destination, 'desktop-server.cjs'),
  "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); require('./server.js');\n");
run(python, ['-m', 'PyInstaller', '--noconfirm', '--distpath', 'desktop/build/backend',
  '--workpath', 'desktop/build/python-work', 'desktop/backend.spec'], repo);
// Refuse to ship credentials or the large research datasets, even if tracing changes.
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.name.startsWith('.env') || /\.(h5|hdf5|tif|tiff|img|sqlite)$/i.test(entry.name)) {
      throw new Error('Private/data asset unexpectedly included: ' + entry.name);
    }
    if (entry.isDirectory()) inspect(item);
  }
}
inspect(destination);
inspect(path.join(desktop, 'build/backend/jmgj-backend'));
console.log('Desktop web + Python worker prepared. Verified Black Marble subset staged separately; no credentials or raw research files.');
