import { describe, expect, it } from 'vitest';
import { alignedAzimuth, CompassFilter, directionVector, readNorthOffset, smoothVector } from '../../../android/web/src/compass';

describe('Android compass direction', () => {
  it('aligns raw north and preserves turns, altitude and repeat alignment', () => {
    expect(alignedAzimuth(123,123)).toBe(0);
    expect(alignedAzimuth(213,123)).toBe(90);
    expect(alignedAzimuth(303,123)).toBe(180);
    expect(alignedAzimuth(3,123)).toBe(240);
    expect(alignedAzimuth(10,350)).toBe(20);
    expect(directionVector(alignedAzimuth(123,123),37)?.[2]).toBeCloseTo(Math.sin(37*Math.PI/180));
    expect(alignedAzimuth(213,213)).toBe(0);
    expect(alignedAzimuth(213,null)).toBe(213);
  });
  it('validates stored calibration and handles blocked storage', () => {
    for (const value of [null,'','NaN','Infinity','-1','360','bad']) expect(readNorthOffset({getItem:()=>value})).toBeNull();
    expect(readNorthOffset({getItem:()=> '123.5'})).toBe(123.5);
    expect(readNorthOffset({getItem:()=> {throw Error('blocked');}})).toBeNull();
  });
  it('turns all the way from north to south without sticking at north', () => {
    const f=new CompassFilter();f.update(0,0,0);
    let v=f.update(180,0,33)!;
    expect(v[1]).toBeGreaterThan(0.1);
    for(let t=66;t<=660;t+=33)v=f.update(180,0,t)!;
    expect(v[0]).toBeLessThan(-0.999);
    expect(Math.hypot(...v)).toBeCloseTo(1);
    expect(smoothVector([0,0,1],[0,0,-1],0.25)[0]).toBeGreaterThan(0.1);
  });
  it('crosses north smoothly and follows upward camera direction', () => {
    const f=new CompassFilter();f.update(359,30,0);
    const v=f.update(1,30,33)!;
    expect(v[0]).toBeGreaterThan(.86);
    expect(Math.abs(v[1])).toBeLessThan(.016);
    for(let t=66;t<=660;t+=33)f.update(90,80,t);
    expect(f.update(90,80,693)?.[2]).toBeCloseTo(Math.sin(80*Math.PI/180),2);
  });
  it('starts fresh after toggle/resume, rejects invalid and old samples, suppresses tiny jitter', () => {
    const f=new CompassFilter();const north=f.update(0,37,10)!;
    expect(f.update(.01,37,43)).toEqual(north);
    expect(f.update(180,37,40)).toBeNull();
    expect(f.update(NaN,37,100)).toBeNull();
    expect(f.update(0,91,100)).toBeNull();
    f.reset();expect(f.update(180,0,110)?.[0]).toBe(-1);
    expect(f.update(90,60,2000)?.[1]).toBeCloseTo(.5);
  });
});
