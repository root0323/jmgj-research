import type { NextApiRequest, NextApiResponse } from "next";
import { validLocation } from "@/lib/meteoblue";
import { backendHeaders } from "@/lib/backend-access";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  if (!process.env.JMGJ_DESKTOP_TOKEN) return res.status(200).json({ enabled: false });
  if (!validLocation(req.body?.location)) return res.status(400).json({ error: "관측 위치를 확인하세요." });
  try {
    const base = (process.env.RESEARCH_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/api/assets/terrain`, {
      method: "POST", headers: { "Content-Type": "application/json", ...backendHeaders() },
      body: JSON.stringify(req.body.location), signal: AbortSignal.timeout(30_000), cache: "no-store",
    });
    if (!response.ok) throw new Error("terrain unavailable");
    return res.status(200).json(await response.json());
  } catch { return res.status(503).json({ error: "지형 자료 연결에 실패했습니다." }); }
}
