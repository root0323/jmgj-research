import { describe, expect, it, vi } from "vitest";
import { currentLocation } from "./geolocation";

describe("current observer location", () => {
  it("uses normal accuracy first and applies actual browser coordinates", async () => {
    const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>((success) => success({ coords: { latitude: 33.425814, longitude: 126.5308195 } } as GeolocationPosition));
    expect(await currentLocation({ getCurrentPosition } as unknown as Geolocation)).toEqual({ latitude: 33.425814, longitude: 126.5308195 });
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false });
  });
  it("retries a timeout with high accuracy, but never substitutes another location", async () => {
    const getCurrentPosition = vi.fn().mockImplementationOnce((_success, failure) => failure({ code: 3 }))
      .mockImplementationOnce((success) => success({ coords: { latitude: 0, longitude: 0 } }));
    expect(await currentLocation({ getCurrentPosition } as unknown as Geolocation)).toEqual({ latitude: 0, longitude: 0 });
    expect(getCurrentPosition.mock.calls[1][2]).toMatchObject({ enableHighAccuracy: true });
  });
  it("does not retry denied permission and explains manual alternatives", async () => {
    const getCurrentPosition = vi.fn((_success, failure) => failure({ code: 1 }));
    await expect(currentLocation({ getCurrentPosition } as unknown as Geolocation)).rejects.toThrow("위치 권한");
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await expect(currentLocation(undefined)).rejects.toThrow("지도·좌표");
    await expect(currentLocation(undefined, false)).rejects.toThrow("HTTPS");
  });
});
