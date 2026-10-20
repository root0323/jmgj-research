import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { loadConstellationLabels, projectConstellationLabels } from "./constellationLabels";
import type { ConstellationLabel } from "./constellationLabels";
import type { StellariumEngine } from "./types";
import styles from "./SkyViewer.module.css";

export function ConstellationLabelsOverlay({ engineRef, enabled, showGround }: {
  engineRef: RefObject<StellariumEngine | null>;
  enabled: boolean;
  showGround: boolean;
}) {
  const [labels, setLabels] = useState<ConstellationLabel[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const textRefs = useRef(new Map<string, SVGTextElement>());

  useEffect(() => {
    if (!enabled || labels.length) return;
    let disposed = false;
    void loadConstellationLabels().then(result => {
      if (!disposed) setLabels(result);
    }).catch(() => { /* Keep the sky usable if the bundled catalogue fails to load. */ });
    return () => { disposed = true; };
  }, [enabled, labels.length]);

  useEffect(() => {
    if (!enabled || !labels.length) return;
    let frame = 0, lastDraw = -Infinity;
    const hide = () => textRefs.current.forEach(text => text.setAttribute("visibility", "hidden"));
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - lastDraw < 30) return;
      lastDraw = now;
      const engine = engineRef.current, svg = svgRef.current;
      if (!engine || !svg) { hide(); return; }
      try {
        const { width, height } = svg.getBoundingClientRect();
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        const points = projectConstellationLabels(engine, labels, width, height, showGround);
        textRefs.current.forEach((text, id) => {
          const point = points.get(id);
          text.setAttribute("visibility", point ? "visible" : "hidden");
          if (point) {
            text.setAttribute("x", String(point.x));
            text.setAttribute("y", String(point.y));
          }
        });
      } catch { hide(); }
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); hide(); };
  }, [enabled, labels, engineRef, showGround]);

  if (!enabled) return null;
  return <svg ref={svgRef} className={styles.constellationLabels} role="group" aria-label="별자리 이름">
    {labels.map(label => <text key={label.id} data-constellation-id={label.id}
      ref={text => { if (text) textRefs.current.set(label.id, text); else textRefs.current.delete(label.id); }}
      visibility="hidden" textAnchor="middle" dominantBaseline="central" fontSize="19"
      fill="#69a7ff" fillOpacity="0.95" stroke="#07101d" strokeWidth="2" paintOrder="stroke">{label.title}</text>)}
  </svg>;
}
