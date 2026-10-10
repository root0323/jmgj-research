import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { StellariumEngine } from "./types";
import { addDataSource, getEngineModule, trySetValue } from "./engineControls";
import { backgroundUrl, prepareBackgroundServiceWorker, readBackgrounds, readSelectedBackground } from "./backgroundStorage";
import type { SavedBackground } from "./backgroundStorage";

export function useBackgrounds(engineRef: RefObject<StellariumEngine | null>, ready: boolean) {
  const [records, setRecords] = useState<SavedBackground[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loaded = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    const [all, active] = await Promise.all([readBackgrounds(), readSelectedBackground()]);
    setRecords(all.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
    setSelected(all.some(record => record.id === active) ? active : null);
  }, []);
  useEffect(() => {
    let stopped = false;
    Promise.all([readBackgrounds(), readSelectedBackground()]).then(([all, active]) => {
      if (stopped) return;
      setRecords(all.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
      setSelected(all.some(record => record.id === active) ? active : null);
    }).catch(() => { if (!stopped) setError("저장한 배경을 읽지 못했습니다. 앱 저장 공간을 확인해 주세요."); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, []);
  useEffect(() => {
    if (!ready || loading) return;
    const engine = engineRef.current;
    if (!engine) return;
    let stopped = false;
    const record = records.find(item => item.id === selected);
    const apply = async () => {
      if (record) await prepareBackgroundServiceWorker();
      if (stopped) return;
      const landscapes = getEngineModule(engine, "landscapes");
      const key = record ? `user-${record.revision}` : "guereins";
      if (record && !loaded.current.has(key)) {
        if (!addDataSource(landscapes, backgroundUrl(record.revision), key)) throw new Error("저장한 배경을 적용하지 못했습니다.");
        loaded.current.add(key);
      }
      trySetValue(engine, ["landscapes.current_id"], key);
      landscapes?.update?.();
      setError("");
      // Drop previously loaded custom landscapes so repeated edits do not keep GPU textures alive.
      for (const oldKey of loaded.current) if (oldKey !== key) {
        const old = engine.getModule?.(`landscapes.${oldKey}`);
        if (old && landscapes?.remove) { landscapes.remove(old); loaded.current.delete(oldKey); }
      }
    };
    apply().catch(() => { if (!stopped) { trySetValue(engine, ["landscapes.current_id"], "guereins"); setError("저장한 배경을 적용하지 못해 기본 배경을 표시합니다. 배경 설정에서 다시 저장해 주세요."); } });
    return () => { stopped = true; };
  }, [ready, loading, selected, records, engineRef]);
  return { records, selected, error, loading, refresh };
}
export type BackgroundController = ReturnType<typeof useBackgrounds>;
