/** Server-only worker credential. Never send it in a browser response. */
export function backendHeaders(): Record<string, string> {
  return process.env.JMGJ_DESKTOP_TOKEN ? { "x-jmgj-desktop-token": process.env.JMGJ_DESKTOP_TOKEN } : {};
}
