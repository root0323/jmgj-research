import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  ...(process.env.JMGJ_DESKTOP_BUILD === "1" ? { output: "standalone", distDir: ".next-desktop" } : {}),
};

export default nextConfig;
