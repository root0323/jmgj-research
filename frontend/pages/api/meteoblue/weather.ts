import type { NextApiRequest, NextApiResponse } from "next";
import { validKey, validLocation, validPlan } from "@/lib/meteoblue";
import { fetchWeather } from "@/lib/meteoblue-server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST 요청만 지원합니다." }); }
  const { apiKey, location, plan } = req.body ?? {};
  if (!validKey(apiKey) || !validLocation(location) || !validPlan(plan)) return res.status(400).json({ error: "키와 위도·경도를 확인하세요." });
  return res.status(200).json(await fetchWeather(apiKey, location, plan));
}

export const config = { api: { bodyParser: { sizeLimit: "8kb" }, responseLimit: "16mb" } };
