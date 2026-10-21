import type { NextApiRequest, NextApiResponse } from "next";
import { validKey } from "@/lib/meteoblue";
import { fetchAccountHistory } from "@/lib/meteoblue-server";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST 요청만 지원합니다." }); }
  const { apiKey, start } = req.body ?? {};
  // Exclude the current UTC day: it is counted locally and may still be incomplete in Accounting API.
  const end = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (!validKey(apiKey) || typeof start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))) return res.status(400).json({ error: "API 키와 시작일을 확인하세요." });
  if (start > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "시작일은 오늘 이전으로 지정하세요." });
  try {
    const history = start > end ? { credits: 0, through: end } : await fetchAccountHistory(apiKey, start, end);
    return res.status(200).json(history);
  } catch {
    return res.status(502).json({ error: "계정 사용량을 동기화하지 못했습니다. 키의 권한과 시작일을 확인하세요. 기존 기록은 유지됩니다." });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "8kb" } } };
