import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

afterEach(() => vi.unstubAllEnvs());

describe("private desktop frontend", () => {
  const token = "a".repeat(64);
  const origin = "http://127.0.0.1:43127";
  function request(headers: Record<string, string> = {}) {
    return new NextRequest(origin, { headers: { host: "127.0.0.1:43127", ...headers } });
  }
  it("leaves ordinary web deployments unchanged", () => {
    vi.stubEnv("JMGJ_DESKTOP_TOKEN", "");
    expect(proxy(request()).status).toBe(200);
  });
  it("requires the launch cookie and same-origin requests", () => {
    vi.stubEnv("JMGJ_DESKTOP_TOKEN", token);
    vi.stubEnv("JMGJ_DESKTOP_ORIGIN", origin);
    const cookie = `jmgj-desktop-session=${token}`;
    expect(proxy(request()).status).toBe(403);
    expect(proxy(request({ cookie })).status).toBe(200);
    expect(proxy(request({ cookie, origin: "https://example.com" })).status).toBe(403);
    expect(proxy(request({ cookie, host: "evil.test:43127" })).status).toBe(403);
    expect(proxy(request({ cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(proxy(request({ cookie: `jmgj-desktop-session=${"é".repeat(64)}` })).status).toBe(403);
  });
});
