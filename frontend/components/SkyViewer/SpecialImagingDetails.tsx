import { useId, useState } from "react";
import type { TelescopeSettings } from "./types";
import { calculateLensFrames, calculatePlanetFrames } from "./imagingGuides";
import type { DeepSkyGuide, ImagingCamera, LensGuide, PlanetGuide } from "./imagingGuides";
import styles from "./ImagingGuidePanel.module.css";

export function LensImagingDetails({ guide, lens, camera }: { guide: DeepSkyGuide; lens: LensGuide; camera: ImagingCamera }) {
  const id = useId();
  const [tracking, setTracking] = useState(false);
  const [seconds, setSeconds] = useState(String(lens.fixedSeconds[0]));
  const [count, setCount] = useState(String(lens.fixedFrames[0]));
  const range = tracking ? lens.trackedSeconds : lens.fixedSeconds;
  const frames = tracking ? lens.trackedFrames : lens.fixedFrames;
  const plan = calculateLensFrames(Number(seconds), Number(count));
  return <div className={styles.guide}>
    <p className={styles.startingNote}>카메라 렌즈 촬영의 시험 시작 범위입니다. 노출 한계는 렌즈·센서·하늘 방향에 따라 달라집니다.</p>
    <fieldset className={styles.cameras}><legend>추적 방식</legend>
      {[false, true].map(value => <label key={String(value)}><input type="radio" name={`${id}-tracking`} checked={tracking === value} onChange={() => {
        setTracking(value); setSeconds(String((value ? lens.trackedSeconds : lens.fixedSeconds)[0])); setCount(String((value ? lens.trackedFrames : lens.fixedFrames)[0]));
      }} />{value ? "적도의 · 추적" : "삼각대 · 고정"}</label>)}
    </fieldset>
    <section><h5>장비 · 필터</h5><p>{lens.note}</p>
      <dl className={styles.metrics}><div><dt>렌즈 초점거리 예시</dt><dd>{lens.focalLength}</dd></div><div><dt>렌즈 조리개 시작 범위</dt><dd>{lens.aperture}</dd></div></dl>
      <p className={styles.hint}>광대역 촬영이 기본입니다. 렌즈 촬영의 조리개는 렌즈에서 설정하며, 저장한 망원경 f수를 렌즈에 적용하지 않습니다. 초점은 별을 확대해 수동으로 맞추세요.</p>
    </section>
    <section><h5>노출 · 감도</h5><dl className={styles.metrics}>
      <div><dt>Shutter speed · 한 장 노출</dt><dd>{range[0]}–{range[1]}초</dd></div><div><dt>Light 시작 장수</dt><dd>{frames[0]}–{frames[1]}장</dd></div>
      <div><dt>{camera === "dslr" ? "ISO 시작 범위" : "Gain · Offset"}</dt><dd>{camera === "dslr" ? lens.iso : "기종별 권장값에서 시험 촬영"}</dd></div>
    </dl><p className={styles.hint}>RAW·수동 노출로 촬영하고 별을 100% 확대해 흐름·포화를 확인하세요. 고정 촬영에서 별이 길어지면 노출을 더 줄이세요. 이 시간은 별 흐름이 없는 최대 노출을 계산한 값이 아닙니다.</p></section>
    <section><h5>Light 프레임 계획</h5><div className={styles.planInputs}>
      <label htmlFor={`${id}-seconds`}>한 장 노출(초)<input id={`${id}-seconds`} type="number" min="0.01" max="3600" step="0.1" value={seconds} onChange={event => setSeconds(event.target.value)} /></label>
      <label htmlFor={`${id}-count`}>Light 장수<input id={`${id}-count`} type="number" min="1" max="10000" step="1" value={count} onChange={event => setCount(event.target.value)} /></label>
    </div>{plan ? <p className={styles.lightTotal}>Light <strong>{plan.count}장</strong><span>총 노출 약 {Number(plan.minutes.toFixed(2))}분</span></p> : <p className={styles.error} role="alert">노출은 0초 초과–3600초, 장수는 1–10000의 정수로 입력하세요.</p>}
      <p className={styles.hint}>불량 프레임·촬영 대기시간은 제외한 계획입니다. 움직이지 않는 전경은 하늘 합성과 분리해 처리하세요.</p>
    </section>
    <section><h5>보정 프레임</h5><p>Flat 25–50장, Dark 20–50장, Bias 50–100장 또는 Dark-flat 25–50장을 시작 예시로 사용합니다. Flat은 같은 조리개·초점·렌즈 방향으로, Dark는 Light와 같은 노출·감도·온도로 촬영하세요. Bias와 Dark-flat의 적용은 센서와 합성 프로그램의 보정 방식을 따릅니다.</p></section>
    <section className={styles.targetTip}><h5>이 대상의 촬영 포인트</h5><p>{guide.note}</p></section>
  </div>;
}

export function PlanetImagingDetails({ guide, camera, telescope }: { guide: PlanetGuide; camera: ImagingCamera; telescope: TelescopeSettings }) {
  const id = useId();
  const [exposure, setExposure] = useState(String(guide.exposureMs[0]));
  const [fps, setFps] = useState("60");
  const [duration, setDuration] = useState(String(guide.clipSeconds[0]));
  const [percent, setPercent] = useState("20");
  const plan = calculatePlanetFrames(Number(exposure), Number(fps), Number(duration), Number(percent));
  const ratio = telescope.focalLengthMm / telescope.apertureMm;
  return <div className={styles.guide}>
    <p className={styles.startingNote}>행성 동영상 촬영의 시험 시작 범위입니다. 시상·구경·카메라·필터에 맞춰 노출과 Gain을 조정하세요.</p>
    <section><h5>촬영 방식 · 필터</h5><p>{guide.filterNote}</p>
      <p>{camera === "dslr" ? "DSLR·미러리스는 가능한 한 원본 픽셀에 가까운 크롭 동영상 모드를 사용하세요. 압축·축소 영상은 미세한 원반 세부를 잃을 수 있어 천체용 고속 카메라가 유리합니다. ISO는 기종별로 조정하고 자동 노출·자동 초점을 끄세요." : camera === "mono" ? "모노 카메라는 R·G·B를 각각 짧게 촬영합니다. 아래 계획은 필터 한 개의 클립 기준이며 채널 전환을 포함한 전체 시간과 자전을 확인하세요." : "컬러 카메라는 한 클립에서 색을 기록합니다. 작은 ROI로 원반을 잘라 읽고, 포화 없이 세부가 보이도록 Gain·Offset을 조정하세요."}</p>
    </section>
    <section><h5>노출 · 영상 길이 · 광학계</h5><dl className={styles.metrics}>
      <div><dt>프레임 노출 · Shutter speed</dt><dd>{guide.exposureMs[0]}–{guide.exposureMs[1]}ms<small>1ms = 0.001초</small></dd></div>
      <div><dt>한 클립 길이</dt><dd>{guide.clipSeconds[0]}–{guide.clipSeconds[1]}초부터</dd></div>
      <div><dt>현재 망원경 f수</dt><dd>{Number.isFinite(ratio) && ratio > 0 ? `f/${Number(ratio.toFixed(1))}` : "미설정"}</dd></div>
      <div><dt>합성할 프레임 시작 비율</dt><dd>상위 10–30%부터</dd></div>
    </dl><p className={styles.hint}>행성 세부 촬영은 망원경 직초점·필요시 바로우로 영상 크기를 확보합니다. f수는 구경·픽셀 크기·시상에 맞춰 결정하며 무조건 크게 하지 않습니다. 카메라 렌즈만으로는 보통 밝은 점이나 작은 원반 위주입니다.</p>
      <p className={styles.hint}>SER 또는 압축이 적은 AVI 등 지원되는 형식으로 짧은 클립을 여러 번 저장합니다. FPS는 카메라에 표시되는 실제 값을 확인하세요. 노출이 길면 그 역수보다 높은 FPS로 새 프레임을 얻을 수 없습니다.</p>
    </section>
    <section><h5>클립 · 프레임 계획</h5><div className={styles.planInputs}>
      <label htmlFor={`${id}-ms`}>프레임 노출(ms)<input id={`${id}-ms`} type="number" min="0.1" max="1000" step="0.1" value={exposure} onChange={event => setExposure(event.target.value)} /></label>
      <label htmlFor={`${id}-fps`}>카메라 FPS<input id={`${id}-fps`} type="number" min="1" max="1000" step="1" value={fps} onChange={event => setFps(event.target.value)} /></label>
      <label htmlFor={`${id}-duration`}>클립 길이(초)<input id={`${id}-duration`} type="number" min="5" max="600" step="1" value={duration} onChange={event => setDuration(event.target.value)} /></label>
      <label htmlFor={`${id}-percent`}>합성에 사용할 비율(%)<input id={`${id}-percent`} type="number" min="1" max="100" step="1" value={percent} onChange={event => setPercent(event.target.value)} /></label>
    </div>{plan ? <><p className={styles.lightTotal}>약 <strong>{plan.captured.toLocaleString()}프레임</strong><span>그중 약 {plan.stacked.toLocaleString()}프레임 합성</span></p>
      <p className={styles.hint}>계산 FPS {Number(plan.effectiveFps.toFixed(1))}. 입력 FPS와 노출의 상한 중 작은 값으로 계산한 한 클립 계획입니다. 실제 저장 속도·프레임 손실·품질 선별에 따라 달라집니다.</p></> : <p className={styles.error} role="alert">노출 0.1–1000ms, FPS 1–1000, 영상 5–600초, 비율 1–100%로 입력하세요.</p>}</section>
    <section><h5>보정 · 합성</h5><p>영상 프레임을 정렬하고 선명한 프레임을 골라 합성한 뒤 디테일을 조정합니다. 딥스카이의 시간 단위 Light 계획이나 Flat·Dark·Bias 장수를 그대로 적용하지 않습니다. 먼지·고정 무늬가 문제가 되면 같은 ROI·Gain·노출 조건의 보정을 프로그램 지원에 맞춰 준비하세요.</p></section>
    <section className={styles.targetTip}><h5>이 행성의 촬영 포인트</h5><p>{guide.note}</p></section>
  </div>;
}
