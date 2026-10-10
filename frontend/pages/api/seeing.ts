import type { NextApiRequest, NextApiResponse } from "next";
import { validLocation } from "@/lib/meteoblue";
import { parseSeeing } from "@/lib/seeing";

export const config = { api: { bodyParser: { sizeLimit: "4kb" }, responseLimit: "1mb" } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const location = req.body?.location;
  if (!validLocation(location)) return res.status(400).json({ error: "관측 위치를 확인하세요." });
  const params = new URLSearchParams({ lon: String(location.longitude), lat: String(location.latitude), product: "astro", output: "json" });
  try {
    const response = await fetch(`https://www.7timer.info/bin/api.pl?${params}`, {
      signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "JMGJ-research/1.0 (https://github.com/root0323/jmgj-research)" },
    });
    if (!response.ok) throw new Error("seeing provider unavailable");
    return res.status(200).json(parseSeeing(await response.json(), location));
  } catch {
    return res.status(502).json({ error: "7Timer 시상 예보를 받지 못했습니다. 저장 자료는 유지됩니다. 잠시 후 다시 시도하세요." });
  }
}
