import { afterEach, expect, it, vi } from "vitest";
import { completePlaceQuery, geocodeLocation, reverseGeocodeLocation, suggestLocations } from "./geo";
afterEach(() => vi.unstubAllGlobals());

it("expands school abbreviations locally and keeps completed names intact", () => {
  expect(completePlaceQuery("제주과학고")).toBe("제주과학고등학교");
  expect(completePlaceQuery("제주중")).toBe("제주중학교");
  expect(completePlaceQuery("제주과학고등학교")).toBeNull();
  expect(completePlaceQuery("Tokyo")).toBeNull();
});

it("uses a separate autocomplete route with cancellation", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ lat: "33.425814", lon: "126.5308195", display_name: "제주과학고등학교" }])));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  const results = await suggestLocations("제주과학", controller.signal);
  expect(results[0].name).toBe("제주과학고등학교");
  expect(fetch.mock.calls[0][0]).toContain("/api/location/suggest?");
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

it("searches through the current site's proxy and reuses a successful school result", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ lat: "33.425814", lon: "126.5308195", display_name: "제주과학고등학교" }])));
  vi.stubGlobal("fetch", fetch);
  expect(await geocodeLocation("제주과학고")).toMatchObject({ latitude: 33.425814, name: "제주과학고등학교" });
  expect(fetch.mock.calls[0][0]).toContain("/api/location/search?");
  await geocodeLocation("제주과학고");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not cache a temporary failure as no search results", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ lat: "48.8584", lon: "2.2945", name: "Eiffel Tower" }])));
  vi.stubGlobal("fetch", fetch);
  await expect(geocodeLocation("Eiffel Tower")).rejects.toThrow("연결");
  expect(await geocodeLocation("Eiffel Tower")).toMatchObject({ longitude: 2.2945 });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps coordinates usable when reverse lookup fails and allows a retry", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ display_name: "입력한 장소" })));
  vi.stubGlobal("fetch", fetch);
  expect(await reverseGeocodeLocation({ latitude: 0, longitude: 0 })).toBeNull();
  expect(await reverseGeocodeLocation({ latitude: 0, longitude: 0 })).toBe("입력한 장소");
});

it("uses Kakao responses live on repeated search, autocomplete and reverse requests", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ lat: "33.4258", lon: "126.5308", display_name: "학교", source: "kakao_keyword" }] });
  vi.stubGlobal("fetch", fetch);
  for (let index = 0; index < 2; index++) {
    await geocodeLocation("카카오 실시간 시험 학교");
    await suggestLocations("카카오 실시간 시험 학교", new AbortController().signal);
  }
  expect(fetch).toHaveBeenCalledTimes(4);
  fetch.mockResolvedValue({ ok: true, json: async () => ({ display_name: "학교 주소", source: "kakao" }) });
  await reverseGeocodeLocation({ latitude: 33.4258, longitude: 126.5308 });
  await reverseGeocodeLocation({ latitude: 33.4258, longitude: 126.5308 });
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(fetch.mock.calls.every((call) => call[1].cache === "no-store")).toBe(true);
});
