import type { NextApiRequest, NextApiResponse } from "next";
import { isObject, validLocation } from "@/lib/meteoblue";
import { backendHeaders } from "@/lib/backend-access";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  if (!validLocation(req.body?.location) || !isObject(req.body?.responses)) return res.status(400).json({ error: "관측 자료를 확인하세요." });
  try {
    const base = (process.env.RESEARCH_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/api/difficulty/evaluate-cached`, {
      method: "POST", headers: { "Content-Type": "application/json", ...backendHeaders() },
      body: JSON.stringify(req.body), signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    if (!response.ok) return res.status(502).json({ error: "저장 자료를 계산하지 못했습니다." });
    return res.status(200).json(await response.json());
  } catch {
    return res.status(503).json({ error: "연구 계산 서버가 연결되지 않았습니다." });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "16mb" } } };
