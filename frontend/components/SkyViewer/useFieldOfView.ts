import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { CameraSettings, EyepieceSettings, SelectedTarget, StellariumEngine, SweObj } from "./types";
import { getCoreNumber, getTargetVector } from "./coordinates";
import { calculateFieldOfView, calculateEyepieceFieldOfView, fieldOfViewEdges, eyepieceFieldOfViewEdges } from "./fieldOfView";
import { EMPTY_EYEPIECE } from "./equipmentSettings";

type Mode = "camera" | "eyepiece";

export function useFieldOfView(engineRef: RefObject<StellariumEngine | null>, targetRef: RefObject<SelectedTarget | null>, ready: boolean, focalLength: number, camera: CameraSettings, eyepiece: EyepieceSettings = EMPTY_EYEPIECE) {
  const [stage, setStage] = useState(0);
  const [mode, setMode] = useState<Mode>("camera");
  const [messageMode, setMessageMode] = useState<Mode>("camera");
  const [message, setMessage] = useState("");
  const originalFov = useRef<number | null>(null);
  const originalProjection = useRef<number | null>(null);
  const field = calculateFieldOfView(focalLength, camera);
  const eyepieceField = calculateEyepieceFieldOfView(focalLength, eyepiece);
  const selectedField = mode === "camera" ? field : eyepieceField;
  const active = stage > 0;

  function close() {
    const engine = engineRef.current;
    if (originalProjection.current !== null && engine?.core) engine.core.projection = originalProjection.current;
    if (originalFov.current !== null) engine?.zoomTo?.(originalFov.current, 0);
    originalFov.current = null; originalProjection.current = null;
    setStage(0); setMessage("");
  }

  useEffect(() => {
    if (stage !== 2) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) { event.preventDefault(); close(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const engine = engineRef.current;
    const core = engine?.core as SweObj | undefined;
    if (!ready || !active || !engine || !core?.add) return;
    if (!selectedField) {
      const timer = window.setTimeout(close, 0);
      return () => window.clearTimeout(timer);
    }
    // Stage two changes the canvas itself to the instrument's aperture shape.
    // Perspective fov is the canvas's shorter dimension (native projection.h/c).
    if (stage === 2) {
      if (originalProjection.current === null) originalProjection.current = getCoreNumber(engine, "projection", 2);
      engine.core!.projection = 1;
      const updatePreview = () => {
        const target = targetRef.current;
        const observer = engine.observer ?? engine.core?.observer as SweObj | undefined;
        if (!target || !observer) { close(); return; }
        const vector = getTargetVector(target.obj, observer, target.vector);
        if (!vector || !engine.convertFrame) return;
        const observed = engine.convertFrame(observer, "ICRF", "OBSERVED", vector);
        engine.lookAt?.(observed.slice(0, 3) as [number, number, number], 0);
        engine.zoomTo?.(selectedField.viewportFov, 0);
      };
      updatePreview();
      const timer = window.setInterval(updatePreview, 200);
      return () => { window.clearInterval(timer); if (originalProjection.current !== null) engine.core!.projection = originalProjection.current; };
    }
    const layer = engine.createLayer?.({ id: `${mode}-field-of-view`, z: 110, visible: true });
    if (!layer?.add) {
      const errorTimer = window.setTimeout(() => { close(); setMessageMode(mode); setMessage("화각 표시 레이어를 만들지 못했습니다."); }, 0);
      return () => window.clearTimeout(errorTimer);
    }
    const objects: SweObj[] = [];
    let previous = "";
    function update() {
      const target = targetRef.current;
      const observer = engine!.observer ?? engine!.core?.observer as SweObj | undefined;
      if (!target || !observer) { close(); return; }
      const vector = getTargetVector(target.obj, observer, target.vector);
      if (!vector) return;
      try {
        const up = engine!.convertFrame?.(observer, "OBSERVED", "ICRF", [0, 0, 1]) ?? [0, 0, 1];
        const edges = mode === "camera" ? fieldOfViewEdges(vector, field!.halfWidth, field!.halfHeight, up) : eyepieceFieldOfViewEdges(vector, eyepieceField!.diameter);
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
      } catch { close(); setMessageMode(mode); setMessage("화각을 표시하지 못했습니다. 천체를 다시 선택해 주세요."); }
    }
    update();
    const timer = window.setInterval(update, 200);
    return () => {
      window.clearInterval(timer);
      objects.forEach(object => { layer.remove?.(object); object.destroy?.(); });
      core.remove?.(layer); layer.destroy?.();
    };
  }, [active, stage, mode, ready, focalLength, camera.sensorWidthMm, camera.sensorHeightMm, eyepiece.focalLengthMm, eyepiece.apparentFieldDegrees, engineRef, targetRef]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(nextMode: Mode = "camera") {
    const engine = engineRef.current;
    const target = targetRef.current;
    if (!engine || !ready) return;
    if (stage === 2 && mode === nextMode) { close(); return; }
    setMessageMode(nextMode);
    if (!target) { setMessage("화각을 볼 천체를 먼저 선택해 주세요."); return; }
    if (!(nextMode === "camera" ? field : eyepieceField)) {
      setMessage(nextMode === "camera" ? "설정에서 카메라 센서 가로·세로 크기를 입력해 주세요." : "망원경 설정에서 접안렌즈 초점거리와 겉보기 시야각을 입력해 주세요."); return;
    }
    if (stage === 0 || mode !== nextMode) {
      if (originalProjection.current !== null) engine.core!.projection = originalProjection.current;
      if (mode !== nextMode && originalFov.current !== null) engine.zoomTo?.(originalFov.current, 0);
      if (originalFov.current === null)
      originalFov.current = getCoreNumber(engine, "fov", Math.PI / 3);
      setMode(nextMode); setStage(1); setMessage(""); return;
    }
    const observer = engine.observer ?? engine.core?.observer as SweObj | undefined;
    const vector = observer && getTargetVector(target.obj, observer, target.vector);
    if (!observer || !vector || !engine.convertFrame) return;
    setStage(2);
  }
  return { stage: mode === "camera" ? stage : 0, eyepieceStage: mode === "eyepiece" ? stage : 0,
    preview: stage === 2 ? { mode, aspect: selectedField?.aspect ?? 1 } : null,
    field, eyepieceField, message: messageMode === "camera" ? message : "", eyepieceMessage: messageMode === "eyepiece" ? message : "",
    toggle: () => toggle("camera"), toggleEyepiece: () => toggle("eyepiece"), close, dismissMessage: () => setMessage("") };
}
