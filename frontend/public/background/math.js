// HiPS mapping adapted from Stellarium Web Engine src/algos/healpix.c and uv_map.c.
// Copyright (c) 2022 Stellarium Labs SRL, AGPL-3.0. See Settings > Sources.
const FACES = [[1,0],[3,0],[5,0],[7,0],[0,-1],[2,-1],[4,-1],[6,-1],[1,-2],[3,-2],[5,-2],[7,-2]];
/** @param {number} n @param {number} size */
export function wrap(n, size) { return ((n % size) + size) % size; }
/** @param {number} n @param {number} lo @param {number} hi */
export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
/** @param {number} face @param {number} u @param {number} v */
export function hipsDirection(face, u, v) {
 // hips.c transposes texture UV before sampling. PNG column/row are v/u
 // in healpix_get_mat3, so bake the same transpose into the exported tiles.
 const x = (FACES[face][0] + v - u) * Math.PI / 4;
 const y = (FACES[face][1] + u + v) * Math.PI / 4;
 let z, phi;
 if (Math.abs(y) > Math.PI / 4) {
  const sigma = 2 - Math.abs(y * 4 / Math.PI);
  z = Math.sign(y) * (1 - sigma * sigma / 3);
  const xc = -Math.PI + (2 * Math.floor((x + Math.PI) * 2 / Math.PI) + 1) * Math.PI / 4;
  phi = sigma > 1e-12 ? xc + (x - xc) / sigma : x;
 } else { z = y * 8 / (Math.PI * 3); phi = x; }
 // The landscape renderer reflects the HiPS Y axis into the observed frame.
 return [wrap(-phi * 180 / Math.PI, 360), Math.asin(clamp(z, -1, 1)) * 180 / Math.PI];
}
/** @param {number} az @param {number} alt @param {{centerAzimuth:number,horizon:number,verticalFov:number}} settings */
export function panoramaUv(az, alt, settings) {
 return [wrap((az - settings.centerAzimuth) / 360 + 0.5, 1), settings.horizon / 100 - alt / settings.verticalFov];
}
/** @param {Uint8ClampedArray|Uint8Array} rgba @param {number} width @param {number} height @param {number} u @param {number} v @param {number[]} result */
export function sampleRgba(rgba, width, height, u, v, result) {
 const x = wrap(u * width - 0.5, width), y = clamp(v * height - 0.5, 0, height - 1);
 const x0 = Math.floor(x), x1 = (x0 + 1) % width, y0 = Math.floor(y), y1 = Math.min(height - 1, y0 + 1);
 const a = x - x0, b = y - y0;
 for (let c = 0; c < 4; c++) result[c] =
  ((1-a)*rgba[(y0*width+x0)*4+c]+a*rgba[(y0*width+x1)*4+c])*(1-b) +
  ((1-a)*rgba[(y1*width+x0)*4+c]+a*rgba[(y1*width+x1)*4+c])*b;
 if (v < 0) result[3] = 0;
}
/** Cubemap faces +X,-X,+Y,-Y,+Z,-Z. @param {number} face @param {number} u @param {number} v */
export function cubeDirection(face, u, v) {
 const a = 2*u-1, b = 1-2*v;
 const vectors = [[1,a,b],[-1,-a,b],[-a,1,b],[a,-1,b],[1-2*v,2*u-1,1],[2*v-1,2*u-1,-1]];
 const [x,y,z] = vectors[face];
 return [wrap(Math.atan2(y,x)*180/Math.PI,360), Math.atan2(z,Math.hypot(x,y))*180/Math.PI];
}
/** @param {number} az @param {number} alt */
export function directionCube(az, alt) {
 const r = Math.PI/180, x=Math.cos(alt*r)*Math.cos(az*r), y=Math.cos(alt*r)*Math.sin(az*r), z=Math.sin(alt*r);
 const ax=Math.abs(x), ay=Math.abs(y), azz=Math.abs(z);
 if (ax >= ay && ax >= azz) return x>=0 ? [0,(y/ax+1)/2,(1-z/ax)/2] : [1,(1-y/ax)/2,(1-z/ax)/2];
 if (ay >= azz) return y>=0 ? [2,(1-x/ay)/2,(1-z/ay)/2] : [3,(x/ay+1)/2,(1-z/ay)/2];
 return z>=0 ? [4,(y/azz+1)/2,(1-x/azz)/2] : [5,(y/azz+1)/2,(x/azz+1)/2];
}
/** @param {ArrayLike<number>} logits @param {number} pixels @param {number} classes @param {number} sky @param {number} scale */
export function skyProbabilities(logits, pixels, classes, sky, scale) {
 const mask = new Uint8Array(pixels);
 for (let p=0;p<pixels;p++) {
  let other=-Infinity;
  for (let c=0;c<classes;c++) if(c!==sky) other=Math.max(other, logits[c*pixels+p]);
  mask[p]=Math.round(255/(1+Math.exp(-(logits[sky*pixels+p]-other)*scale)));
 }
 return mask;
}
