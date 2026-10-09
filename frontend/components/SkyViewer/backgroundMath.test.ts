import { describe, expect, it } from "vitest";
import { cubeDirection, directionCube, hipsDirection, panoramaUv, sampleRgba, skyProbabilities } from "../../public/background/math.js";
describe("panorama geometry", () => {
  it("aligns a full panorama horizon and north orientation", () => {
    const settings = { centerAzimuth: 0, horizon: 50, verticalFov: 180 };
    expect(panoramaUv(0, 0, settings)).toEqual([0.5, 0.5]);
    expect(panoramaUv(180, 90, settings)).toEqual([0, 0]);
    expect(panoramaUv(270, -90, settings)).toEqual([0.25, 1]);
    expect(panoramaUv(90, 0, {...settings, centerAzimuth: 90})).toEqual([0.5,0.5]);
  });
  it("keeps a narrow vertical panorama's missing upper sky transparent", () => {
    const colors = new Uint8ClampedArray([10,20,30,255,40,50,60,255]);
    const out = [0,0,0,0]; sampleRgba(colors,2,1,0.5,-0.2,out);
    expect(out[3]).toBe(0);
    sampleRgba(colors,2,1,0.5,1.2,out); expect(out[3]).toBe(255);
  });
  it("interpolates across the longitude seam", () => {
    const colors = new Uint8ClampedArray([10,0,0,255,30,0,0,255]);
    const out = [0,0,0,0]; sampleRgba(colors,2,1,0,0.5,out); expect(out[0]).toBe(20);
  });
  it("uses Stellarium's reflected HiPS observed frame for the cardinal directions", () => {
    expect(hipsDirection(4,0.5,0.5)).toEqual([0,0]);
    expect(hipsDirection(7,0.5,0.5)).toEqual([90,0]);
    expect(hipsDirection(6,0.5,0.5)).toEqual([180,0]);
    expect(hipsDirection(5,0.5,0.5)).toEqual([270,0]);
    expect(hipsDirection(0,1,1)[1]).toBeCloseTo(90);
    expect(hipsDirection(8,0,0)[1]).toBeCloseTo(-90);
    expect(hipsDirection(4,0.75,0.25)).toEqual([22.5,0]);
    for (const t of [0.1,0.5,0.9]) {
      expect(hipsDirection(4,0,t)).toEqual(hipsDirection(8,1,t));
    }
  });
  it("roundtrips cubemap faces including poles and the 360 degree seam", () => {
    for (let face=0;face<6;face++) for(const u of [0.05,0.3,0.5,0.8,0.95]) for(const v of [0.05,0.5,0.95]) {
      const [az,alt]=cubeDirection(face,u,v), [actualFace,actualU,actualV]=directionCube(az,alt);
      expect(actualFace).toBe(face); expect(actualU).toBeCloseTo(u); expect(actualV).toBeCloseTo(v);
    }
  });
});
it("retains competing foreground classes while removing the model's sky class", () => {
  const logits = new Uint8Array(19*3); logits.fill(10);
  logits[10*3]=30; logits[8*3+1]=30; logits[10*3+2]=20; logits[2*3+2]=20;
  const mask=skyProbabilities(logits,3,19,10,0.3346128761768341);
  expect(mask[0]).toBeGreaterThan(250); expect(mask[1]).toBeLessThan(5); expect(mask[2]).toBe(128);
});
