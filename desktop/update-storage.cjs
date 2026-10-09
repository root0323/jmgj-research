const archiveFs = require('node:fs');
// Electron presents ASAR files as virtual directories. Cleanup must operate on
// the physical archive. Transparent reads also leave the old archive open on
// Windows, so identity is read through a bounded, explicitly closed file handle.
let fs;
try { fs = require('original-fs'); } catch { fs = archiveFs; }
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const APP_NAME = 'jmgj-research-desktop';
const CACHE_NAME = 'jmgj-research-desktop-updater';
const LEGACY_FILES = ['AstroSky.exe', 'JMGJ Research.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
  'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll', 'icudtl.dat', 'LICENSE.electron.txt',
  'LICENSES.chromium.html', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
  'vk_swiftshader_icd.json', 'vk_swiftshader.dll', 'vulkan-1.dll', 'locales'];
const LEGACY_RESOURCES = ['backend', 'web', 'data', 'licenses', 'NOTICE.txt', 'app-update.yml', 'elevate.exe'];

function version(value) {
  return /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
}
function older(a, b) {
  const left = version(a), right = version(b);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i];
  return false;
}
function within(candidate, root) {
  const normalize = value => path.resolve(value).toLowerCase();
  const relative = path.relative(normalize(root), normalize(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function overlaps(a, b) { return within(a, b) || within(b, a); }
async function stat(file) {
  try { return await fsp.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function protectedRoots(roots) {
  const result = [];
  for (const root of roots.filter(Boolean)) {
    result.push(path.resolve(root));
    try { result.push(await fsp.realpath(root)); } catch { /* Preserve lexical protection for absent folders. */ }
  }
  return result;
}
async function treeBytes(file, boundary, protectedPaths, signal) {
  signal?.throwIfAborted();
  if (!within(file, boundary) || protectedPaths.some(root => overlaps(file, root))) return null;
  const info = await stat(file);
  if (!info) return 0;
  if (info.isSymbolicLink() || !within(await fsp.realpath(file), boundary)) return null;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return null;
  let total = 0;
  for (const entry of await fsp.readdir(file)) {
    const bytes = await treeBytes(path.join(file, entry), boundary, protectedPaths, signal);
    if (bytes === null) return null;
    total += bytes;
  }
  return total;
}
async function digest(file, signal) {
  const hash = crypto.createHash('sha512');
  for await (const bytes of fs.createReadStream(file, { signal })) hash.update(bytes);
  return hash.digest('base64');
}

async function packageIdentity(archive) {
  const info = await stat(archive);
  if (info?.isDirectory()) return JSON.parse(await fsp.readFile(path.join(archive, 'package.json'), 'utf8'));
  if (!info?.isFile() || info.isSymbolicLink()) return null;
  const handle = await fsp.open(archive, 'r');
  try {
    const read = async (size, offset) => {
      if (offset < 0 || offset + size > info.size) throw new Error('Invalid archive range');
      const buffer = Buffer.alloc(size);
      if ((await handle.read(buffer, 0, size, offset)).bytesRead !== size) throw new Error('Incomplete archive');
      return buffer;
    };
    const size = await read(8, 0), headerSize = size.readUInt32LE(4);
    if (size.readUInt32LE(0) !== 4 || headerSize < 8 || headerSize > 16 * 1024 * 1024) return null;
    const header = await read(headerSize, 8), jsonSize = header.readUInt32LE(4);
    if (header.readUInt32LE(0) !== headerSize - 4 || jsonSize > headerSize - 8) return null;
    const entry = JSON.parse(header.subarray(8, 8 + jsonSize).toString('utf8')).files?.['package.json'];
    if (!entry || entry.unpacked || entry.link || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 65536 || !/^\d+$/.test(entry.offset)) return null;
    const offset = Number(entry.offset);
    if (!Number.isSafeInteger(offset)) return null;
    return JSON.parse((await read(entry.size, 8 + headerSize + offset)).toString('utf8'));
  } finally { await handle.close(); }
}

async function cleanInstalledCache({ cacheRoot, currentVersion, protectedPaths, signal }) {
  if (!cacheRoot || path.basename(cacheRoot) !== CACHE_NAME) return 0;
  const rootStat = await stat(cacheRoot);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return 0;
  const root = await fsp.realpath(cacheRoot), pending = path.join(root, 'pending');
  const pendingStat = await stat(pending);
  if (!pendingStat?.isDirectory() || pendingStat.isSymbolicLink()) return 0;
  const infoFile = path.join(pending, 'update-info.json');
  const infoStat = await stat(infoFile);
  if (!infoStat?.isFile() || infoStat.isSymbolicLink() || infoStat.size > 8192) return 0;
  const info = JSON.parse(await fsp.readFile(infoFile, 'utf8'));
  const match = /^JMGJ-Research-(\d+\.\d+\.\d+)-Windows-(?:x64|arm64)-Setup\.exe$/.exec(info.fileName || '');
  // A future/deferred update must remain installable. Only the already running
  // version can be discarded, and only when the reusable cache is identical.
  if (!match || match[1] !== currentVersion || typeof info.sha512 !== 'string') return 0;
  const installer = path.join(root, 'installer.exe'), downloaded = path.join(pending, info.fileName);
  const blockmap = path.join(root, 'current.blockmap'), pendingMap = path.join(pending, 'current.blockmap');
  const targets = [installer, downloaded, blockmap, pendingMap, infoFile];
  const before = await Promise.all(targets.map(file => stat(file)));
  if (before.some(s => !s?.isFile() || s.isSymbolicLink()) ||
      targets.some(file => protectedPaths.some(p => overlaps(file, p)))) return 0;
  if (before[0].size !== before[1].size || before[2].size !== before[3].size) return 0;
  const hashes = await Promise.all(targets.slice(0, 4).map(file => digest(file, signal)));
  if (hashes[0] !== info.sha512 || hashes[1] !== info.sha512 || hashes[2] !== hashes[3]) return 0;
  const after = await Promise.all(targets.map(file => stat(file)));
  if (after.some((s, i) => !s || s.isSymbolicLink() || s.size !== before[i].size || s.mtimeMs !== before[i].mtimeMs)) return 0;
  let reclaimed = 0;
  for (const i of [1, 3, 4]) {
    signal?.throwIfAborted();
    await fsp.unlink(targets[i]);
    reclaimed += before[i].size;
  }
  try { await fsp.rmdir(pending); } catch { /* Unknown files are retained. */ }
  return reclaimed;
}

async function cleanRenamedInstallation({ execPath, currentVersion, protectedPaths, signal }) {
  const current = path.dirname(path.resolve(execPath)), legacy = path.dirname(current);
  // The known 0.7.1 migration appended AstroSky beneath the original folder.
  // Never search other drives, sibling installations or arbitrary user folders.
  if (path.basename(current) !== 'AstroSky' || path.basename(legacy) !== 'JMGJ Research') return 0;
  const roots = await Promise.all([stat(current), stat(legacy)]);
  if (roots.some(s => !s?.isDirectory() || s.isSymbolicLink())) return 0;
  const boundary = await fsp.realpath(legacy), active = await fsp.realpath(current);
  if (!within(active, boundary) || active === boundary) return 0;
  const resources = path.join(boundary, 'resources');
  const resourceStat = await stat(resources);
  if (!resourceStat?.isDirectory() || resourceStat.isSymbolicLink()) return 0;
  const marker = path.join(resources, 'jmgj-installed.txt'), archive = path.join(resources, 'app.asar');
  if (await treeBytes(marker, boundary, protectedPaths, signal) === null ||
      await treeBytes(archive, boundary, protectedPaths, signal) === null) return 0;
  if (await fsp.readFile(marker, 'utf8') !== 'nsis') return 0;
  const pkg = await packageIdentity(archive);
  if (pkg?.name !== APP_NAME || !older(pkg.version, currentVersion) || older('0.7.1', pkg.version)) return 0;
  const preserved = [...protectedPaths, active];
  let reclaimed = 0, incomplete = false;
  for (const relative of [...LEGACY_FILES, ...LEGACY_RESOURCES.map(name => path.join('resources', name))]) {
    const target = path.join(boundary, relative);
    const bytes = await treeBytes(target, boundary, preserved, signal);
    if (bytes === null) { incomplete = true; continue; }
    signal?.throwIfAborted();
    // Executables come first: an in-use old executable stops the migration
    // before removing the resources that process could still need.
    await fsp.rm(target, { recursive: true, force: true });
    reclaimed += bytes;
  }
  if (!incomplete) {
    for (const target of [archive, marker, path.join(boundary, 'Uninstall AstroSky.exe'), path.join(boundary, 'Uninstall JMGJ Research.exe')]) {
      const bytes = await treeBytes(target, boundary, preserved, signal);
      if (bytes === null) continue;
      signal?.throwIfAborted();
      await fsp.rm(target, { recursive: true, force: true });
      reclaimed += bytes;
    }
    try { await fsp.rmdir(resources); } catch { /* Preserve unknown files. */ }
  }
  // The parent contains the live app. It is never recursively deleted.
  return reclaimed;
}

async function cleanupAfterSuccessfulStart(options) {
  if (!options.installed || !version(options.currentVersion)) return { legacyBytes: 0, cacheBytes: 0 };
  const protectedPaths = await protectedRoots([...(options.protectedPaths || []), path.dirname(options.execPath)]);
  const args = { ...options, protectedPaths };
  const result = { legacyBytes: 0, cacheBytes: 0 };
  // Failure in one optional cleanup cannot prevent the app or updater working.
  for (const [field, operation] of [['legacyBytes', cleanRenamedInstallation], ['cacheBytes', cleanInstalledCache]]) {
    try { result[field] = await operation(args); }
    catch (error) { options.log?.(`update storage cleanup deferred ${field} (${typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'ERROR'})`); }
  }
  return result;
}

module.exports = { cleanupAfterSuccessfulStart };
