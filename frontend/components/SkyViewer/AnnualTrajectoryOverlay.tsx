import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { getCoreNumber } from "./coordinates";
import { observedTargetVector, projectViewVector, sampleAnnualTrajectory, trajectoryCacheKey, trajectorySvgPath } from "./annualTrajectory";
import type { TrajectoryPoint } from "./annualTrajectory";
import type { SelectedTarget, StellariumEngine, SweObj } from "./types";
import styles from "./SkyViewer.module.css";

export function AnnualTrajectoryOverlay({ engineRef, targetRef, timeRef, enabled, showGround }: {
  engineRef: RefObject<StellariumEngine | null>;
  targetRef: RefObject<SelectedTarget | null>;
  timeRef: RefObject<Date>;
  enabled: boolean;
  showGround: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const markerRef = useRef<SVGGElement>(null);
  const titleRef = useRef<HTMLTitleElement>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, frame = 0, lastDraw = -Infinity;
    let points: TrajectoryPoint[] = [], cachedKey = "", pendingKey = "", targetId: number | null = null;
    let controller: AbortController | null = null;
    const hide = () => {
      pathRef.current?.setAttribute("d", "");
      markerRef.current?.setAttribute("visibility", "hidden");
      svgRef.current?.setAttribute("visibility", "hidden");
    };
    const draw = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(draw);
      if (now - lastDraw < 60) return;
      lastDraw = now;
      const engine = engineRef.current, target = targetRef.current, svg = svgRef.current;
      const observer = engine?.observer ?? engine?.core?.observer as SweObj | undefined;
      if (!engine?.convertFrame || !target || !observer || !svg) {
        controller?.abort(); controller = null; pendingKey = ""; cachedKey = "";
        targetId = null; points = []; hide(); return;
      }
      if (target.obj.v !== targetId) {
        controller?.abort(); controller = null; pendingKey = ""; cachedKey = "";
        targetId = target.obj.v; points = []; hide();
      }
      const time = new Date(timeRef.current);
      const key = trajectoryCacheKey(target, time, observer);
      if (cachedKey !== key && !pendingKey) {
        const currentController = new AbortController();
        controller = currentController; pendingKey = key;
        void sampleAnnualTrajectory(engine, target, time, currentController.signal).then(result => {
          if (disposed || currentController.signal.aborted || targetRef.current?.obj.v !== target.obj.v) return;
          points = result; cachedKey = key;
        }).catch(() => {
          if (!disposed && !currentController.signal.aborted) { points = []; cachedKey = key; hide(); }
        }).finally(() => { if (controller === currentController) { controller = null; pendingKey = ""; } });
      }
      try {
        const { width, height } = svg.getBoundingClientRect();
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        const rawFov = getCoreNumber(engine, "fov", Math.PI / 3);
        const fov = rawFov > Math.PI ? rawFov * Math.PI / 180 : rawFov;
        const projection = getCoreNumber(engine, "projection", 1);
        const project = (vector: number[]) => showGround && vector[2] < 0 ? null :
          projectViewVector(engine.convertFrame!(observer, "OBSERVED", "VIEW", [...vector, 0]), width, height, fov, projection);
        pathRef.current?.setAttribute("d", trajectorySvgPath(points.map(point => project(point.vector))));
        const current = observedTargetVector(engine, target, observer);
        const marker = current && project(current);
        if (marker && markerRef.current) {
          markerRef.current.setAttribute("transform", `translate(${marker.x},${marker.y})`);
          markerRef.current.setAttribute("visibility", "visible");
        } else markerRef.current?.setAttribute("visibility", "hidden");
        if (titleRef.current) titleRef.current.textContent = `${target.label} · ${time.getFullYear()}년 매일 같은 시각의 위치 · 현재 위치는 원으로 표시`;
        svg.setAttribute("visibility", "visible");
      } catch { hide(); }
    };
    frame = requestAnimationFrame(draw);
    return () => { disposed = true; cancelAnimationFrame(frame); controller?.abort(); hide(); };
  }, [enabled, showGround, engineRef, targetRef, timeRef]);

  if (!enabled) return null;
  return <svg ref={svgRef} className={styles.annualTrajectory} role="img" aria-label="선택한 천체의 별궤적" visibility="hidden">
    <title ref={titleRef}>매일 같은 시각에 본 1년간의 천체 위치</title>
    <path ref={pathRef} fill="none" stroke="#9cddff" strokeWidth="1.5" strokeDasharray="3 5" strokeLinecap="round" />
    <g ref={markerRef} visibility="hidden" fill="#ffdf91" stroke="#111827" strokeWidth="3" paintOrder="stroke">
      <circle r="4" stroke="#ffdf91" strokeWidth="1.5" fill="#111827" />
      <text x="10" y="4" fontSize="12">현재</text>
    </g>
  </svg>;
}
