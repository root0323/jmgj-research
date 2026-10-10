import { describe, expect, it } from 'vitest';
import { directionVector, smoothVector } from '../../android/web/src/compass';
describe('Android sky direction', () => {
  it('uses north/east/up in the engine observed frame', () => {
    expect(directionVector(0, 0)).toEqual([1, 0, 0]);
    const east = directionVector(90, 0)!;
    expect(east[0]).toBeCloseTo(0); expect(east[1]).toBeCloseTo(1);
    expect(directionVector(0, 90)![2]).toBeCloseTo(1);
    expect(directionVector(NaN, 0)).toBeNull(); expect(directionVector(0, 91)).toBeNull();
  });
  it('crosses north smoothly instead of turning south at 360 degrees', () => {
    const value = smoothVector(directionVector(359, 0), directionVector(1, 0)!, 0.5);
    expect(value[0]).toBeCloseTo(1); expect(value[1]).toBeCloseTo(0); expect(Math.hypot(...value)).toBeCloseTo(1);
  });
});
