import { useEffect, useState } from "react";
import { createSeeingLoader } from "@/lib/automatic-seeing";
import { type WeatherLocation } from "@/lib/meteoblue";
import { readSeeing, saveSeeing } from "@/lib/weather-storage";
import { seeingAt, seeingCacheKey, seeingTimeSlot, SEEING_CACHE_LIFETIME_MS, type SeeingSnapshot } from "@/lib/seeing";

const loadSeeing = createSeeingLoader({
  read: readSeeing,
  save: saveSeeing,
  request: async (location) => {
    const response = await fetch("/api/seeing", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location }),
    });
    if (!response.ok) throw new Error("seeing unavailable");
    return response.json();
  },
});

type State = {
  key: string;
  snapshot: SeeingSnapshot | null;
  loading: boolean;
  error: boolean;
  storageWarning: boolean;
};

export function useAutomaticSeeing(location: WeatherLocation, observationTime: Date) {
  const { latitude, longitude } = location;
  const slot = seeingTimeSlot(observationTime);
  const key = slot ? seeingCacheKey(location, new Date(slot)) : "";
  const [state, setState] = useState<State | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!slot) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // Wait for location/time controls to settle. Shared pending requests also
    // prevent duplicate network calls during StrictMode and repeated selections.
    timer = setTimeout(() => {
      setState({ key, snapshot: null, loading: true, error: false, storageWarning: false });
      void loadSeeing({ latitude, longitude }, new Date(slot)).then(({ snapshot, persisted }) => {
        if (cancelled) return;
        setState({ key, snapshot, loading: false, error: false, storageWarning: !persisted });
        timer = setTimeout(() => setRevision((value) => value + 1),
          Math.max(1000, Date.parse(snapshot.fetchedAt) + SEEING_CACHE_LIFETIME_MS - Date.now()));
      }).catch(() => {
        if (cancelled) return;
        setState({ key, snapshot: null, loading: false, error: true, storageWarning: false });
        // Retry transient failures without a manual panel or a tight request loop.
        timer = setTimeout(() => setRevision((value) => value + 1), 60_000);
      });
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, latitude, longitude, slot, revision]);

  // A late response for a previous selection is saved but never shown here.
  const current = state?.key === key ? state : null;
  const point = seeingAt(current?.snapshot ?? null, observationTime);
  const loading = !!slot && (!current || current.loading);
  const message = loading ? "시상을 불러오는 중입니다."
    : current?.error ? "시상을 받지 못했습니다. 잠시 후 자동으로 다시 시도합니다."
    : !point ? "선택한 시각이 예보 범위 밖이거나 해당 구간의 시상 자료가 없습니다."
    : `${new Date(point.at).toLocaleString("ko-KR")} 예보 구간의 예측 범위입니다. 현장 실측값은 아닙니다.`;
  return { label: point?.label, loading, message, storageWarning: current?.storageWarning ?? false };
}
