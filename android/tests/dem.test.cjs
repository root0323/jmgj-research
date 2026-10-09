const { test } = require('node:test');
const assert = require('node:assert/strict');
const encode = require('../model/dem.js');
function image(raster = 2) { return { getWidth: () => 3, getHeight: () => 2,
  getGeoKeys: () => ({ GeographicTypeGeoKey: 4326, GTRasterTypeGeoKey: raster }),
  fileDirectory: { ModelPixelScale: [1 / 1200, 1 / 1200, 0], ModelTiepoint: [0, 0, 0, 126, 38, 0] }, getGDALNoData: () => -32767 }; }
test('float32 elevations, missing value and point coordinates survive without quantization', () => {
  const pixels = new Float32Array([-32767, -12.3125, 0, 12.345, 1950.75, 8848.86]);
  const bytes = encode(image(), pixels), view = new DataView(bytes.buffer), tags = new Map();
  for (let i = 0; i < view.getUint16(8, true); i++) {
    const pos = 10 + 12 * i; tags.set(view.getUint16(pos, true), { type: view.getUint16(pos + 2, true), count: view.getUint32(pos + 4, true), offset: view.getUint32(pos + 8, true) });
  }
  assert.equal(tags.get(256).offset, 3); assert.equal(tags.get(257).offset, 2);
  assert.equal(tags.get(258).offset, 32); assert.equal(tags.get(339).offset, 3);
  assert.equal(tags.get(279).offset, pixels.byteLength);
  assert.deepEqual(bytes.slice(tags.get(273).offset), new Uint8Array(pixels.buffer));
  const geo = tags.get(34735); assert.equal(view.getUint16(geo.offset + 22, true), 2);
  assert.equal(view.getUint16(geo.offset + 30, true), 4326);
  const scale = tags.get(33550); assert.equal(view.getFloat64(scale.offset, true), 1 / 1200);
  const tie = tags.get(33922); assert.equal(view.getFloat64(tie.offset + 24, true), 126);
  const nodata = tags.get(42113); assert.equal(new TextDecoder().decode(bytes.slice(nodata.offset, nodata.offset + nodata.count)), '-32767\0');
});
test('unsupported coordinate system or non-float input is rejected', () => {
  assert.throws(() => encode(image(), new Uint16Array(6)));
  assert.throws(() => encode(image(0), new Float32Array(6)));
  const other = image(); other.getGeoKeys = () => ({ GeographicTypeGeoKey: 3857, GTRasterTypeGeoKey: 1 });
  assert.throws(() => encode(other, new Float32Array(6)));
});
