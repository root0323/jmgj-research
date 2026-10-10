const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { optimizeRenderer, ORIGINAL, OPTIMIZED } = require('../scripts/prepare-renderer.cjs');

test('Android rendering preserves pixel density and resizes only when actual size changes', () => {
  let width=0,height=0,resizes=0,frames=0,rect={width:360,height:728};
  const canvas={getBoundingClientRect:()=>rect,get width(){return width;},set width(v){width=v;resizes++;},get height(){return height;},set height(v){height=v;resizes++;}};
  const context={Module:{canvas,_core_update(){},_core_render(w,h,dpr){assert.equal(dpr,3);assert.equal(w,rect.width);assert.equal(h,rect.height);frames++;}},mouseDown:false,document:{hidden:false},window:{devicePixelRatio:3,requestAnimationFrame(){}}};
  vm.createContext(context);vm.runInContext(OPTIMIZED,context);
  for(let t=0;t<1000;t+=1000/120)context.render(t);
  assert.equal(resizes,2);assert.equal(width,1080);assert.equal(height,2184);
  assert.ok(frames>=29 && frames<=31,`frames=${frames}`);
  rect={width:752,height:336};context.render(1100);assert.equal(resizes,4);assert.equal(width,2256);
  context.document.hidden=true;context.render(1200);assert.equal(frames,31);
});
test('Renderer adaptation fails visibly if upstream renderer changes', () => {
  const source=fs.readFileSync(require('node:path').resolve(__dirname,'../../frontend/public/stellarium/stellarium-web-engine.js'),'utf8');
  assert.ok(optimizeRenderer(source).includes(OPTIMIZED));
  assert.throws(()=>optimizeRenderer(source.replace(ORIGINAL,'changed')));
});
