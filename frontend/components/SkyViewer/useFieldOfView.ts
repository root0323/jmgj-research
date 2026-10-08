import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CameraSettings, SelectedTarget, StellariumEngine, SweObj } from "./types";
import { getCoreNumber, getTargetVector } from "./coordinates";
import { calculateFieldOfView, fieldOfViewEdges } from "./fieldOfView";

export function useFieldOfView(engineRef: RefObject<StellariumEngine | null>, targetRef: RefObject<SelectedTarget | null>, ready: boolean, focalLength: number, camera: CameraSettings) {
  const [stage, setStage] = useState(0);
  const [message, setMessage] = useState("");
  const originalFov = useRef<number | null>(null);
  const field = calculateFieldOfView(focalLength, camera);
  const active = stage > 0;

  useEffect(() => {
    const engine = engineRef.current;
    const core = engine?.core as SweObj | undefined;
    if (!ready || !active || !engine || !core?.add || !field) return;
    const layer = engine.createLayer?.({ id: "camera-field-of-view", z: 110, visible: true });
    if (!layer?.add) {
      const errorTimer = window.setTimeout(() => { setStage(0); setMessage("화각 표시 레이어를 만들지 못했습니다."); }, 0);
      return () => window.clearTimeout(errorTimer);
    }
    const objects: SweObj[] = [];
    let previous = "";
    let previousTarget = targetRef.current?.obj;
    function update() {
      const target = targetRef.current;
      const observer = engine!.observer ?? engine!.core?.observer as SweObj | undefined;
      if (!target || !observer) { setStage(0); return; }
      if (target.obj !== previousTarget) { previousTarget = target.obj; setStage(1); originalFov.current = null; }
      const vector = getTargetVector(target.obj, observer, target.vector);
      if (!vector) return;
      try {
        const edges = fieldOfViewEdges(vector, field!.halfWidth, field!.halfHeight);
        const serialized = JSON.stringify(edges);
        if (serialized === previous) return;
        edges.forEach((data, index) => {
          if (!objects[index]) {
            const object = engine!.createObj?.("geojson", {});
            if (!object) throw new Error("Cannot create field of view");
            object.data = data;
            objects.push(object); object.z = 16; layer!.add!(object);
          }
          objects[index].data = data;
          objects[index].update?.();
        });
        layer!.update?.(); core!.update?.(); engine!._core_update?.(); previous = serialized;
      } catch { setStage(0); setMessage("화각을 표시하지 못했습니다. 천체를 다시 선택해 주세요."); }
    }
    update();
    const timer = window.setInterval(update, 200);
    return () => {
      window.clearInterval(timer);
      objects.forEach(object => { layer.remove?.(object); object.destroy?.(); });
      core.remove?.(layer); layer.destroy?.();
    };
  }, [active, ready, focalLength, camera.sensorWidthMm, camera.sensorHeightMm, engineRef, targetRef]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    const engine = engineRef.current;
    const target = targetRef.current;
    if (!engine || !ready) return;
    if (stage === 2) {
      setStage(0); setMessage("");
      if (originalFov.current !== null) engine.zoomTo?.(originalFov.current, 1.2);
      originalFov.current = null; return;
    }
    if (!target) { setMessage("화각을 볼 천체를 먼저 선택해 주세요."); return; }
    if (!field) { setMessage("설정에서 카메라 센서 가로·세로 크기를 입력해 주세요."); return; }
    if (stage === 0) {
      originalFov.current = getCoreNumber(engine, "fov", Math.PI / 3);
      setStage(1); setMessage(""); return;
    }
    const observer = engine.observer ?? engine.core?.observer as SweObj | undefined;
    const vector = observer && getTargetVector(target.obj, observer, target.vector);
    if (!observer || !vector || !engine.convertFrame) return;
    const observed = engine.convertFrame(observer, "ICRF", "OBSERVED", vector);
    engine.lookAt?.(observed.slice(0, 3) as [number, number, number], 1.2);
    engine.zoomTo?.(field.fit, 1.2); setStage(2);
  }
  return { stage, field, message, toggle, dismissMessage: () => setMessage("") };
}
