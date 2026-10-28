import { describe, it, expect } from '../../frontend/node_modules/vitest';
import { BrowserOrientation, rearDirection } from './orientation';
describe('rear camera pointing', () => {
  it.each([[0,0],[270,90],[180,180],[90,270]])('turns alpha %s to bearing %s', (alpha, bearing) => {
    const d = rearDirection(alpha,90,0)!; expect(d.azimuth).toBeCloseTo(bearing); expect(d.altitude).toBeCloseTo(0);
  });
  it('points at the sky instead of using the flat phone heading', () => {
    expect(rearDirection(0,127,0)!.altitude).toBeCloseTo(37);
    expect(rearDirection(0,170,0)!.altitude).toBeCloseTo(80);
    expect(rearDirection(0,0,0)!.altitude).toBeCloseTo(-90);
  });
  it('has no fixed north before a fresh compass reference', () => {
    const o = new BrowserOrientation(); expect(o.sample({alpha:0,beta:90,gamma:0,absolute:false})).toBeNull();
    expect(o.sample({alpha:0,beta:90,gamma:0,absolute:false,webkitCompassHeading:180})).toBeNull();
  });
  it('converts Safari heading and keeps it through vertical movement', () => {
    const o = new BrowserOrientation();
    const value = o.sample({alpha:30,beta:60,gamma:0,absolute:false,webkitCompassHeading:120})!;
    expect(value.azimuth).toBeCloseTo(120);
    expect(o.sample({alpha:30,beta:90,gamma:0,absolute:false,webkitCompassHeading:0})!.azimuth).toBeCloseTo(120);
    o.reset(); expect(o.sample({alpha:30,beta:90,gamma:0,absolute:false})).toBeNull();
  });
  it('allows absolute north and south after every activation', () => {
    const o = new BrowserOrientation();
    expect(o.sample({alpha:0,beta:127,gamma:0,absolute:true})!.azimuth).toBeCloseTo(0);
    o.reset(); expect(o.sample({alpha:180,beta:127,gamma:0,absolute:true})!.azimuth).toBeCloseTo(180);
  });
});
