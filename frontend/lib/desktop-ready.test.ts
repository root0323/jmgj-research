import { afterEach, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "../pages/api/desktop-ready";

afterEach(() => vi.unstubAllEnvs());

it("exposes only a small uncached readiness response in desktop mode", () => {
  const response = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), end: vi.fn() };
  response.status.mockReturnValue(response);
  vi.stubEnv("JMGJ_DESKTOP_TOKEN", "");
  handler({} as NextApiRequest, response as unknown as NextApiResponse);
  expect(response.status).toHaveBeenLastCalledWith(404);
  expect(response.json).not.toHaveBeenCalled();
  vi.stubEnv("JMGJ_DESKTOP_TOKEN", "a".repeat(64));
  handler({} as NextApiRequest, response as unknown as NextApiResponse);
  expect(response.status).toHaveBeenLastCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({ ok: true });
  expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
});
