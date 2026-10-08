import { useEffect, useState } from "react";
import type { ObserverLocation } from "./types";

type TerrainState = { enabled: boolean; state: string; message: string; dem?: boolean; blackMarble?: boolean };

export function useAutomaticTerrain({ latitude, longitude }: ObserverLocation) {
  const key = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  const [result, setResult] = useState<(TerrainState & { key: string }) | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch("/api/research/assets", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location: { latitude, longitude } }), signal: controller.signal,
        });
        if (!response.ok) throw new Error("terrain unavailable");
        const data = await response.json() as TerrainState;
        if (cancelled) return;
        setResult({ ...data, key });
        if (data.enabled && ["running", "waiting", "idle"].includes(data.state)) timer = setTimeout(poll, 2000);
      } catch {
        if (!cancelled) setResult({ key, enabled: true, state: "error", message: "지형 자료 연결에 실패했습니다." });
      }
    }
    timer = setTimeout(() => void poll(), 700);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [key, latitude, longitude, retry]);
  const current = result?.key === key ? result : null;
  return { enabled: current?.enabled ?? false, state: current?.state,
    message: current?.message, readyKey: current?.state === "ready" ? key : "",
    retry: () => setRetry((value) => value + 1) };
}
