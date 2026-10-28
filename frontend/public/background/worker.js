import { clamp, wrap, hipsDirection, panoramaUv, sampleRgba, cubeDirection, directionCube, skyProbabilities } from './math.js';
const progress = text => postMessage({ progress: text });
async function decode(blob) {
 const bitmap = await createImageBitmap(blob);
 const scale = Math.min(1, 4096 / bitmap.width, 2048 / bitmap.height);
 const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
 const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
 context.drawImage(bitmap, 0, 0, width, height); bitmap.close();
 return { width, height, canvas, context, pixels: context.getImageData(0, 0, width, height).data };
}
function sampleMask(mask, width, height, u, v) {
 const x = clamp(u*width-0.5,0,width-1), y=clamp(v*height-0.5,0,height-1);
 const x0=Math.floor(x), y0=Math.floor(y), x1=Math.min(width-1,x0+1), y1=Math.min(height-1,y0+1);
 return (mask[y0*width+x0]*(1-(x-x0))+mask[y0*width+x1]*(x-x0))*(1-(y-y0)) +
        (mask[y1*width+x0]*(1-(x-x0))+mask[y1*width+x1]*(x-x0))*(y-y0);
}
async function analyse(source, settings) {
 const image=await decode(source);
 progress('하늘 인식 모델 준비 중…');
 const ort=await import('/background-runtime/ort.wasm.min.mjs');
 ort.env.wasm.wasmPaths='/background-runtime/'; ort.env.wasm.numThreads=1;
 const session=await ort.InferenceSession.create('/background-model/ffnet_40s.onnx', {
  executionProviders:['wasm'], externalData:[{path:'ffnet_40s.data',data:'/background-model/ffnet_40s.data'}],
 });
 const masks=[], color=[0,0,0,0], plane=2048*1024;
 try {
  for(let face=0;face<6;face++) {
   progress(`하늘 자동 제거 중… ${face+1}/6`);
   const input=new Uint8Array(plane*3);
   for(let y=0;y<1024;y++) for(let x=0;x<2048;x++) {
    const [az,alt]=cubeDirection(face,(x+0.5)/2048,(y+0.5)/1024);
    const [u,v]=panoramaUv(az,alt,settings);
    sampleRgba(image.pixels,image.width,image.height,u,v,color);
    const p=y*2048+x;
    for(let c=0;c<3;c++) input[c*plane+p]=Math.round(color[c]);
   }
   const results=await session.run({image:new ort.Tensor('uint8',input,[1,3,1024,2048])});
   const output=results.mask;
   if(output.type!=='uint8'||output.dims.join(',')!=='1,19,128,256') throw new Error('인식 모델의 출력 형식이 맞지 않습니다.');
   masks.push(skyProbabilities(output.data,128*256,19,10,0.3346128761768341));
   output.dispose();
  }
 } finally { await session.release(); }
 progress('투명한 배경 만드는 중…');
 const maskCanvas=new OffscreenCanvas(image.width,image.height), ctx=maskCanvas.getContext('2d');
 const data=ctx.createImageData(image.width,image.height);
 let skyPixels=0;
 for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
  const az=wrap((x+0.5)/image.width*360+settings.centerAzimuth-180,360);
  const alt=(settings.horizon/100-(y+0.5)/image.height)*settings.verticalFov;
  const [face,u,v]=directionCube(az,clamp(alt,-90,90));
  const sky=sampleMask(masks[face],256,128,u,v)/255;
  const opacity=Math.round(255*clamp((0.75-sky)/0.5,0,1));
  const p=(y*image.width+x)*4;
  data.data[p]=data.data[p+1]=data.data[p+2]=255; data.data[p+3]=opacity;
  if(opacity<128) skyPixels++;
 }
 ctx.putImageData(data,0,0);
 return { mask:await maskCanvas.convertToBlob({type:'image/png'}), width:image.width,height:image.height, skyFraction:skyPixels/(image.width*image.height) };
}
async function tiles(source, mask, settings) {
 const image=await decode(source), bitmap=await createImageBitmap(mask);
 image.context.globalCompositeOperation='destination-in'; image.context.drawImage(bitmap,0,0,image.width,image.height); bitmap.close();
 image.context.globalCompositeOperation='source-over';
 const pixels=image.context.getImageData(0,0,image.width,image.height).data;
 const size=image.width>2048?1024:512, result=[], color=[0,0,0,0];
 for(let face=0;face<12;face++) {
  progress(`배경 적용 준비 중… ${face+1}/12`);
  const canvas=new OffscreenCanvas(size,size), context=canvas.getContext('2d'), data=context.createImageData(size,size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
   const [az,alt]=hipsDirection(face,(x+0.5)/size,(y+0.5)/size);
   const [u,v]=panoramaUv(az,alt,settings);
   sampleRgba(pixels,image.width,image.height,u,v,color);
   const p=(y*size+x)*4;
   for(let c=0;c<4;c++) data.data[p+c]=Math.round(color[c]);
  }
  context.putImageData(data,0,0); result.push(await canvas.convertToBlob({type:'image/png'}));
 }
 return { tiles:result,size,width:image.width,height:image.height };
}
self.onmessage=async event=>{
 try {
  const {action,source,settings,mask}=event.data;
  const result=action==='analyse'?await analyse(source,settings):await tiles(source,mask,settings);
  postMessage({result});
 } catch(error) { postMessage({error:error instanceof Error?error.message:String(error)}); }
};
