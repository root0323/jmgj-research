const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const desktop = path.resolve(__dirname, '..');
const repo = path.dirname(desktop);
const frontend = path.join(repo, 'frontend');
const python = process.env.JMGJ_BUILD_PYTHON || path.join(repo, '.venv/Scripts/python.exe');
const version = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;
const backendStage = `desktop/build/backend-${version}`;
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
function copy(source, target) {
  if (process.platform !== 'win32') return fs.cpSync(source, target, { recursive: true, filter });
  // Native copying avoids Node cpSync failures on the OneDrive checkout.
  // Never copy private environment files; the final inspection also rejects them.
  const result = spawnSync('robocopy', [source, target, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1',
    '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XF', '.env*'], { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status === null || result.status > 7) throw new Error('Runtime copy failed');
}
copy(path.join(frontend, '.next-desktop/standalone'), destination);
copy(path.join(frontend, '.next-desktop/static'), path.join(destination, '.next-desktop/static'));
copy(path.join(frontend, 'public'), path.join(destination, 'public'));
fs.writeFileSync(path.join(destination, 'desktop-server.cjs'),
  "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); require('./server.js');\n");
run(python, ['-m', 'PyInstaller', '--noconfirm', '--distpath', backendStage,
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
inspect(path.join(repo, backendStage, 'jmgj-backend'));
console.log('Desktop web + Python worker prepared. Only the pinned Black Marble catalogue ships; no worldwide H5s, credentials or raw research files.');
