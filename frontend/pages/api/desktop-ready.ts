import type { NextApiRequest, NextApiResponse } from "next";

// The desktop proxy authenticates this route before it reaches the handler.
// Probe a small response instead of repeatedly rendering the entire sky page.
export default function handler(_request: NextApiRequest, response: NextApiResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (!process.env.JMGJ_DESKTOP_TOKEN) return response.status(404).end();
  response.status(200).json({ ok: true });
}
