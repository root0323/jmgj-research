// Execute the actual packaged Python model under Pyodide and native Python.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const bundle = path.join(root, 'android/build/mobile-model');
const { unzipSync } = require(path.join(root, 'frontend/node_modules/fflate'));
const { loadPyodide } = require(path.join(bundle, 'pyodide/pyodide.js'));
const probe = `
import json
from app.services.sky_brightness_model.core.config import EnvironmentConfig
from app.services.sky_brightness_model.core.modern_sky import run_modern_pipeline
config=EnvironmentConfig(physics_model='sos3d',aod=.1,cloud_fraction=.5,
                         cloud_base_h=2,cloud_optical_depth=1,moon_phase_angle_deg=20,
                         transport_n_mu=4,transport_n_phi=8,transport_tolerance=.01)
pixels=[{'distance_km':1.,'phi_c_rad':0.,'radiance':10.,'shield_deg':0.}]
parts=run_modern_pipeline(pixels,(30,180),(45,90),config,return_components=True)
report={'total':parts['total'],'components':[parts[k] for k in
        ['I_art_final','I_cloud_final','I_ml_final','I_bg_final']],
        'orders':{k:parts['transport'][k]['scattering_orders'] for k in ['clear','cloudy']}}
`;
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'BUILD.json')));
  const files = unzipSync(new Uint8Array(fs.readFileSync(path.join(bundle, 'model.zip'))));
  for (const [name, hash] of Object.entries(manifest.sourceHashes)) {
    if (!files[name] || crypto.createHash('sha256').update(files[name]).digest('hex') !== hash) throw Error('Invalid bundled source: ' + name);
    if (!name.endsWith('.py')) continue;
    const current = name === 'backend/src/mobile.py' ? path.join(root, 'android/model/mobile.py') : path.join(root, name);
    if (crypto.createHash('sha256').update(fs.readFileSync(current)).digest('hex') !== hash) throw Error('Stale model bundle: ' + name);
  }
  const py = await loadPyodide({ indexURL: path.join(bundle, 'pyodide') + path.sep });
  await py.loadPackage('numpy');
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.endsWith('.py')) continue;
    const target = '/research/' + name;
    py.FS.mkdirTree(path.posix.dirname(target)); py.FS.writeFile(target, bytes);
  }
  const start = performance.now();
  const mobile = JSON.parse(await py.runPythonAsync(`
import sys,types
sys.path.insert(0,'/research/backend/src')
stub=types.ModuleType('numba')
def njit(function):
    function.py_func=function
    return function
stub.njit=njit
sys.modules['numba']=stub
` + probe + '\njson.dumps(report)'));
  const native = JSON.parse(execFileSync(path.join(root, '.venv/Scripts/python.exe'), ['-c', probe + '\nprint(json.dumps(report))'],
    { cwd: root, env: { ...process.env, PYTHONPATH: path.join(root, 'backend/src') }, encoding: 'utf8', windowsHide: true }));
  const relative = Math.max(...mobile.components.map((v, i) => Math.abs(v / native.components[i] - 1)));
  if (!Number.isFinite(relative) || relative > 1e-9 || JSON.stringify(mobile.orders) !== JSON.stringify(native.orders)) throw Error('Native/WASM physics mismatch');
  console.log(JSON.stringify({ passed: true, pyodide: py.version, maxRelativeDifference: relative,
    secondsIncludingNativeCheck: (performance.now() - start) / 1000, mobile, native }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
