import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

// Only enabled by the desktop launcher. A rotating HttpOnly cookie isolates
// this loopback server from other browser tabs and websites on the computer.
export function proxy(request: NextRequest) {
  const token = process.env.JMGJ_DESKTOP_TOKEN;
  if (!token) return NextResponse.next();
  const supplied = request.cookies.get("jmgj-desktop-session")?.value || "";
  const origin = process.env.JMGJ_DESKTOP_ORIGIN;
  const from = request.headers.get("origin");
  if (!origin || !/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== token.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)) ||
      request.headers.get("host") !== new URL(origin).host || (from && from !== origin) ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    return new NextResponse("Desktop session required", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
