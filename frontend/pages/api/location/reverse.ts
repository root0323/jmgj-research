import type { NextApiRequest, NextApiResponse } from "next";
import { proxyLocation } from "@/lib/location-proxy";
export default function handler(req: NextApiRequest, res: NextApiResponse) { return proxyLocation(req, res, "reverse"); }
