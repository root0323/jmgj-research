/* Float32 TIFF conversion for GDAL/WASM. No resampling or numeric conversion. */
(function (root) {
  function encodeRawDem(image, pixels) {
    const width = image.getWidth(), height = image.getHeight();
    const fd = image.fileDirectory, keys = image.getGeoKeys();
    if (!(pixels instanceof Float32Array) || pixels.length !== width * height || keys.GeographicTypeGeoKey !== 4326 || ![1, 2].includes(keys.GTRasterTypeGeoKey)) throw Error('지원하지 않는 DEM 형식');
    const scale = Array.from(fd.ModelPixelScale), tie = Array.from(fd.ModelTiepoint);
    if (scale.length !== 3 || tie.length !== 6 || ![...scale, ...tie].every(Number.isFinite)) throw Error('DEM 좌표 정보 없음');
    const noData = image.getGDALNoData();
    const tags = [
      [256, 4, [width]], [257, 4, [height]], [258, 3, [32]],
      [259, 3, [1]], [262, 3, [1]], [273, 4, [0]],
      [277, 3, [1]], [278, 4, [height]], [279, 4, [pixels.byteLength]],
      [284, 3, [1]], [339, 3, [3]], [33550, 12, scale],
      [33922, 12, tie],
      [34735, 3, [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, keys.GTRasterTypeGeoKey, 2048, 0, 1, 4326]],
    ];
    if (noData !== null) tags.push([42113, 2, Array.from(new TextEncoder().encode(String(noData) + '\0'))]);
    tags.sort((a, b) => a[0] - b[0]);
    const sizes = { 2: 1, 3: 2, 4: 4, 12: 8 };
    let extra = 8 + 2 + tags.length * 12 + 4;
    const align = n => Math.ceil(n / 8) * 8;
    extra = align(extra);
    for (const tag of tags) if (tag[2].length * sizes[tag[1]] > 4) extra += align(tag[2].length * sizes[tag[1]]);
    const pixelOffset = extra;
    tags.find(tag => tag[0] === 273)[2][0] = pixelOffset;
    const bytes = new Uint8Array(pixelOffset + pixels.byteLength), view = new DataView(bytes.buffer);
    view.setUint16(0, 0x4949, true); view.setUint16(2, 42, true); view.setUint32(4, 8, true); view.setUint16(8, tags.length, true);
    extra = align(8 + 2 + tags.length * 12 + 4);
    tags.forEach(([id, type, values], index) => {
      const entry = 10 + index * 12, count = values.length, length = count * sizes[type];
      view.setUint16(entry, id, true); view.setUint16(entry + 2, type, true); view.setUint32(entry + 4, count, true);
      const offset = length <= 4 ? entry + 8 : extra;
      if (length > 4) { view.setUint32(entry + 8, extra, true); extra += align(length); }
      values.forEach((value, i) => {
        const p = offset + i * sizes[type];
        if (type === 12) view.setFloat64(p, value, true);
        else if (type === 4) view.setUint32(p, value, true);
        else if (type === 3) view.setUint16(p, value, true);
        else view.setUint8(p, value);
      });
    });
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] === 1) bytes.set(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), pixelOffset);
    else pixels.forEach((value, i) => view.setFloat32(pixelOffset + 4 * i, value, true));
    return bytes;
  }
  root.encodeRawDem = encodeRawDem;
  if (typeof module !== 'undefined') module.exports = encodeRawDem;
})(globalThis);
