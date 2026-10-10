/* One sequential worker owns Python and geometry. UI and sensors stay responsive. */
let runtime, queue = Promise.resolve(), downloadId = 0;
const downloads = new Map();
async function init() {
  if (runtime) return runtime;
  runtime = (async () => {
    importScripts('/mobile-model/pyodide/pyodide.js');
    importScripts('/mobile-model/geotiff.js');
    importScripts('/mobile-model/dem.js');
    const py = await loadPyodide({ indexURL: '/mobile-model/pyodide/' });
    await py.loadPackage(['numpy', 'rasterio', 'h5py', 'fastapi', 'httpx', 'requests', 'sqlite3']);
    py.FS.mkdir('/research');
    py.FS.writeFile('/model.zip', new Uint8Array(await (await fetch('/mobile-model/model.zip')).arrayBuffer()));
    await py.runPythonAsync("import zipfile, sys\nzipfile.ZipFile('/model.zip').extractall('/research')\nsys.path.insert(0, '/research/backend/src')\nimport mobile");
    return py;
  })().catch(error => { runtime = null; throw error; });
  return runtime;
}
async function acquire(py, item) {
  const id = ++downloadId;
  const path = await new Promise((resolve, reject) => { downloads.set(id, { resolve, reject }); postMessage({ download: true, id, ...item }); });
  const response = await fetch(path);
  if (!response.ok) throw Error('저장된 지역 자료를 읽지 못했습니다.');
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (item.name.endsWith('.tif')) {
    // GDAL/WASM lacks TIFF Deflate. Decode original pixels, without resampling,
    // and change compression only in the transient worker filesystem.
    const tiff = await GeoTIFF.fromArrayBuffer(bytes.buffer);
    const image = await tiff.getImage();
    const pixels = await image.readRasters({ samples: [0] });
    bytes = encodeRawDem(image, pixels[0]);
  }
  py.FS.writeFile('/regional-data/' + item.name, bytes);
}
self.onmessage = ({ data }) => {
  if (data.downloadResult) {
    const work = downloads.get(data.downloadResult); if (!work) return;
    downloads.delete(data.downloadResult); data.error ? work.reject(Error(data.error)) : work.resolve(data.path); return;
  }
  queue = queue.then(async () => {
    try {
      const py = await init();
      const mobile = py.pyimport('mobile');
      try {
        let value;
        if (data.action === 'prepare') {
          const { latitude, longitude, key } = data.payload;
          postMessage({ key, progress: '지역 자료 목록 확인 중…' });
          await acquire(py, { url: 'https://copernicus-dem-90m.s3.amazonaws.com/tileList.txt', name: 'tileList.txt' });
          const plan = JSON.parse(mobile.plan(latitude, longitude));
          for (let index = 0; index < plan.length; index++) {
            postMessage({ key, progress: `지형·야간광 저장 ${index + 1}/${plan.length}` });
            await acquire(py, plan[index]);
          }
          postMessage({ key, progress: '지형·야간광 자료 검증 중…' });
          value = JSON.parse(mobile.prepare(latitude, longitude));
        } else if (data.action === 'evaluate') value = JSON.parse(mobile.evaluate(JSON.stringify(data.payload)));
        else throw Error('지원하지 않는 계산 요청');
        postMessage({ id: data.id, value });
      } finally { mobile.destroy(); }
    } catch (e) {
      // Python tracebacks may contain scientific request values. Show safe UI text.
      postMessage({ id: data.id, error: e instanceof Error && !String(e).includes('Traceback') ? e.message : '지역 자료 또는 계산 준비에 실패했습니다. 저장 공간과 네트워크를 확인하세요.' });
    }
  });
};
