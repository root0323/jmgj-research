import type { NextApiRequest, NextApiResponse } from "next";

export async function proxyLocation(req: NextApiRequest, res: NextApiResponse, action: "search" | "suggest" | "reverse") {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).end(); }
  const params = new URLSearchParams();
  if (action === "search" || action === "suggest") {
    if (typeof req.query.query !== "string" || req.query.query.trim().length < 2 || req.query.query.length > 160) return res.status(400).json({ error: "검색어를 확인하세요." });
    params.set("query", req.query.query.trim());
  } else if (action === "reverse") {
    if (typeof req.query.lat !== "string" || !req.query.lat.trim() || typeof req.query.lon !== "string" || !req.query.lon.trim() ||
      !Number.isFinite(Number(req.query.lat)) || Math.abs(Number(req.query.lat)) > 90 || !Number.isFinite(Number(req.query.lon)) || Math.abs(Number(req.query.lon)) > 180) return res.status(400).json({ error: "좌표를 확인하세요." });
    params.set("lat", req.query.lat); params.set("lon", req.query.lon);
  } else return res.status(404).end();
  try {
    const base = (process.env.GEOCODE_BACKEND_URL || process.env.RESEARCH_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/api/geocode${action === "reverse" ? "/reverse" : action === "suggest" ? "/suggest" : "/"}?${params}`, {
      signal: AbortSignal.timeout(25_000), cache: "no-store",
    });
    if (!response.ok) throw new Error("geocode unavailable");
    return res.status(200).json(await response.json());
  } catch { return res.status(503).json({ error: "장소 검색 서버에 연결하지 못했습니다." }); }
}
