const fs = require('node:fs');
const path = require('node:path');

// Android-only adaptation of the bundled engine; keep the upstream file intact.
const ORIGINAL = 'var render=function(timestamp){if(mouseDown)Module._core_on_mouse(0,1,mousePos.x,mousePos.y,mouseButtons);var canvas=Module.canvas;var dpr=window.devicePixelRatio||1;var rect=canvas.getBoundingClientRect();var displayWidth=rect.width;var displayHeight=rect.height;var sizeChanged=canvas.width!==displayWidth||canvas.height!==displayHeight;if(sizeChanged){canvas.width=displayWidth*dpr;canvas.height=displayHeight*dpr}Module._core_update();Module._core_render(displayWidth,displayHeight,dpr);window.requestAnimationFrame(render)};';
const OPTIMIZED = `var lastAndroidRender=-Infinity;var render=function(timestamp){
window.requestAnimationFrame(render);
if(document.hidden||timestamp-lastAndroidRender<1000/30-0.5)return;
lastAndroidRender=timestamp;
if(mouseDown)Module._core_on_mouse(0,1,mousePos.x,mousePos.y,mouseButtons);
var canvas=Module.canvas;var dpr=window.devicePixelRatio||1;var rect=canvas.getBoundingClientRect();
var displayWidth=rect.width;var displayHeight=rect.height;
var width=Math.round(displayWidth*dpr),height=Math.round(displayHeight*dpr);
if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
Module._core_update();Module._core_render(displayWidth,displayHeight,dpr)
};`;

function optimizeRenderer(source) {
  if (source.split(ORIGINAL).length !== 2) throw Error('Engine renderer changed; review Android adaptation before packaging');
  return source.replace(ORIGINAL, OPTIMIZED);
}
if (require.main === module) {
  const target = path.resolve(__dirname, '../app/src/main/assets/web/stellarium/stellarium-web-engine.js');
  fs.writeFileSync(target, optimizeRenderer(fs.readFileSync(target, 'utf8')));
  console.log('Android renderer: stable physical canvas size, original pixel density, max 30 fps');
}
module.exports = { optimizeRenderer, ORIGINAL, OPTIMIZED };
