import { useEffect, useId, useRef, useState } from "react";
import type { TelescopeSettings } from "./types";
import {
  IMAGING_GUIDES, IMAGING_PROFILES, availableImagingRecipes, calculateImagingFrames,
  defaultImagingRecipe, imagingExposureRange, searchImagingGuides,
  imagingGuideLabel,
} from "./imagingGuides";
import type { DeepSkyGuide, ImagingCamera, ImagingGuide, ImagingRecipe } from "./imagingGuides";
import { LensImagingDetails, PlanetImagingDetails } from "./SpecialImagingDetails";
import styles from "./ImagingGuidePanel.module.css";

const CAMERAS: readonly { id: ImagingCamera; label: string }[] = [
  { id: "dslr", label: "DSLR · 미러리스" }, { id: "color", label: "천체용 컬러" }, { id: "mono", label: "천체용 모노" },
];
const RECIPE_LABELS: Record<ImagingRecipe, string> = {
  RGB: "광대역 · RGB", LRGB: "LRGB", HaRGB: "Hα + RGB", dual: "듀얼밴드 · Hα/OⅢ", HOO: "HOO · Hα/OⅢ", SHO: "SHO · SⅡ/Hα/OⅢ",
};

export function ImagingGuidePanel({ telescope }: { telescope: TelescopeSettings }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ImagingGuide | null>(null);
  const [camera, setCamera] = useState<ImagingCamera>("dslr");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const previousTarget = useRef<string | null>(null);
  const listScroll = useRef(0);
  const results = searchImagingGuides(query);
  useEffect(() => {
    if (selected) headingRef.current?.focus();
    else if (previousTarget.current && catalogRef.current) {
      catalogRef.current.querySelector<HTMLButtonElement>(`[data-target="${previousTarget.current}"]`)?.focus({ preventScroll: true });
      catalogRef.current.scrollTop = listScroll.current;
    }
  }, [selected]);
  return (
    <div className={styles.panel}>
      {selected ? <>
        <button type="button" className={styles.backButton} onClick={() => setSelected(null)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h14" /></svg>목록으로 돌아가기
        </button>
        <div className={styles.details}>
          <div className={styles.targetTitle}><span>{imagingGuideLabel(selected)}</span>
            <h4 ref={headingRef} tabIndex={-1}>{selected.name}</h4><p>{selected.catalog}</p>
          </div>
          <fieldset className={styles.cameras}><legend>촬영 카메라</legend>
            {CAMERAS.map(option => <label key={option.id}>
              <input type="radio" name={`${id}-camera`} value={option.id} checked={camera === option.id} onChange={() => setCamera(option.id)} />{option.label}
            </label>)}
          </fieldset>
          {selected.kind === "planet" ? <PlanetImagingDetails key={`${selected.id}-${camera}`} guide={selected} camera={camera} telescope={telescope} /> :
            <DeepSkyDetails key={`${selected.id}-${camera}`} guide={selected} camera={camera} telescope={telescope} />}
        </div>
      </> : <>
      <div className={styles.search}>
        <label htmlFor={`${id}-search`}>촬영 대상 검색</label>
        <div><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
          <input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="장미 성운, M31, 은하수, 목성…" autoComplete="off" />
        </div>
      </div>
        <div ref={catalogRef} className={styles.catalog} aria-label="천체 촬영 대상 목록">
          <p className={styles.resultCount} role="status">{results.length} / {IMAGING_GUIDES.length}개 촬영 대상·구도</p>
          <p className={styles.catalogHint}>함께 표시한 천체는 촬영 구도를 기준으로 묶었습니다. 대상별 필터·보완 노출은 상세 정보에서 확인하세요.</p>
          <ul>
            {results.map(item => <li key={item.id}>
              <button type="button" data-target={item.id} onClick={() => {
                listScroll.current = catalogRef.current?.scrollTop ?? 0;
                previousTarget.current = item.id;
                setSelected(item);
              }}>
                <strong>{item.name}</strong><span>{item.catalog}</span><small>{item.season}</small>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
              </button>
            </li>)}
          </ul>
          {results.length === 0 && <p className={styles.emptySearch}>검색 결과가 없습니다. 다른 이름이나 천체 번호로 검색해 보세요.</p>}
        </div>
      </>}
    </div>
  );
}

function DeepSkyDetails({ guide, camera, telescope }: { guide: DeepSkyGuide; camera: ImagingCamera; telescope: TelescopeSettings }) {
  const [optics, setOptics] = useState(guide.lensOnly ? "lens" : "telescope");
  return <>
    {guide.lens && !guide.lensOnly && <fieldset className={styles.cameras}><legend>촬영 장비</legend>
      <label><input type="radio" name={`${guide.id}-optics`} checked={optics === "telescope"} onChange={() => setOptics("telescope")} />망원경</label>
      <label><input type="radio" name={`${guide.id}-optics`} checked={optics === "lens"} onChange={() => setOptics("lens")} />카메라 렌즈 · 망원경 없이</label>
    </fieldset>}
    {optics === "lens" && guide.lens ? <LensImagingDetails guide={guide} lens={guide.lens} camera={camera} /> : <GuideDetails guide={guide} camera={camera} telescope={telescope} />}
  </>;
}

function GuideDetails({ guide, camera, telescope }: { guide: DeepSkyGuide; camera: ImagingCamera; telescope: TelescopeSettings }) {
  const id = useId();
  const profile = IMAGING_PROFILES[guide.profile];
  const [recipe, setRecipe] = useState<ImagingRecipe>(defaultImagingRecipe(guide, camera));
  const [seconds, setSeconds] = useState(String(imagingExposureRange(guide, recipe)[0]));
  const [hours, setHours] = useState(String(profile.hours[0]));
  const range = imagingExposureRange(guide, recipe);
  const plan = calculateImagingFrames(camera, recipe, Number(seconds), Number(hours));
  const focalRatio = telescope.focalLengthMm / telescope.apertureMm;
  const ratioLabel = Number.isFinite(focalRatio) && focalRatio > 0 ? `f/${Number(focalRatio.toFixed(1))}` : "미설정";
  return <div className={styles.guide}>
    <p className={styles.startingNote}>적도의 추적 촬영의 시작 범위입니다. 카메라 기종·광공해·달빛·추적 오차에 맞춰 시험 촬영 후 조정하세요.</p>
    <section><h5>필터 · 촬영 방식</h5><p>{profile.filterNote}</p>
      <label className={styles.recipe} htmlFor={`${id}-recipe`}><span>촬영 방식</span>
        <select id={`${id}-recipe`} value={recipe} onChange={event => {
          const next = event.target.value as ImagingRecipe;
          setRecipe(next); setSeconds(String(imagingExposureRange(guide, next)[0]));
        }}>{availableImagingRecipes(guide, camera).map(value => <option key={value} value={value}>{RECIPE_LABELS[value]}</option>)}</select>
      </label>
      {camera !== "mono" && <p className={styles.hint}>컬러 센서는 한 장에서 RGB를 기록합니다. LRGB·SHO용 단일 필터를 모노 카메라처럼 각각 촬영할 필요는 없습니다. UV/IR 차단은 카메라·광학계 사양에 맞추세요.</p>}
    </section>
    <section><h5>노출 · 감도 · f수</h5>
      <dl className={styles.metrics}>
        <div><dt>Shutter speed · 한 장 노출</dt><dd>{range[0]}–{range[1]}초</dd></div>
        <div><dt>목표 총 노출 · 모든 채널 합계</dt><dd>{profile.hours[0]}–{profile.hours[1]}시간부터</dd></div>
        <div><dt>{camera === "dslr" ? "ISO 시작 범위" : "Gain · Offset"}</dt><dd>{camera === "dslr" ? "ISO 800–1600" : "기종별 권장값 · HCG 전환점 참고"}</dd></div>
        <div><dt>설정한 망원경 f수</dt><dd>{ratioLabel}<small>초점거리 ÷ 구경</small></dd></div>
      </dl>
      <p className={styles.hint}>{camera === "dslr" ? "ISO의 적정값은 기종마다 다릅니다. RAW·수동 노출·수동 초점을 사용하고, 기종별 읽기 노이즈·다이내믹 레인지를 확인하세요. 미개조 카메라는 Hα에 대한 감도가 낮을 수 있습니다." : "천체용 카메라는 ISO 대신 Gain·Offset을 사용합니다. 제조사 권장값을 확인하고 냉각 온도를 일정하게 유지하세요. 다른 기종의 Gain 숫자를 그대로 옮기지 마세요."}</p>
      <p className={styles.hint}>망원경 f수는 장비의 값이므로 이 탭에서 바꾸지 않습니다. 카메라 렌즈는 f/2.8–5.6 부근에서 별 모양을 시험하고, 리듀서 사용 시 망원경 설정에 실제 초점거리를 반영하세요.</p>
      <p className={styles.hint}>밝은 별·중심부가 포화되거나 별이 길어지면 한 장 노출을 줄이세요. 협대역은 더 긴 노출을 사용할 수 있지만 추적·포화를 먼저 확인하세요.</p>
    </section>
    <section><h5>Light 프레임 계획</h5>
      <div className={styles.planInputs}>
        <label htmlFor={`${id}-seconds`}>한 장 노출(초)<input id={`${id}-seconds`} type="number" min="1" max="3600" step="1" value={seconds} onChange={event => setSeconds(event.target.value)} /></label>
        <label htmlFor={`${id}-hours`}>총 노출(시간)<input id={`${id}-hours`} type="number" min="0.25" max="100" step="0.25" value={hours} onChange={event => setHours(event.target.value)} /></label>
      </div>
      {plan ? <>
        <p className={styles.lightTotal}>Light <strong>{plan.count}장</strong><span>합계 약 {Number(plan.actualHours.toFixed(2))}시간</span></p>
        <div className={styles.channelCounts}>{plan.frames.map(row => <span key={row.channel}>{row.channel} <strong>{row.count}장</strong></span>)}</div>
        <p className={styles.hint}>총 노출 ÷ 한 장 노출로 계산한 계획입니다. {camera === "mono" && <>모노 채널은 {recipe === "LRGB" || recipe === "HaRGB" ? "L 또는 Hα 40%, R·G·B 각 20%" : "같은 시간"}으로 나눈 예시이며, 약한 채널에 더 배분하세요. </>}모든 채널의 한 장 노출을 같게 계산했고 HDR 추가분·불량 프레임·촬영 간 대기시간은 포함하지 않습니다.</p>
      </> : <p className={styles.error} role="alert">한 장 노출은 1–3600초, 총 노출은 0.25–100시간으로 입력하세요.</p>}
    </section>
    <section><h5>보정 프레임 · 대상에 공통</h5>
      <div className={styles.tableWrap}><table><thead><tr><th>프레임</th><th>시작 장수</th><th>촬영 조건</th></tr></thead><tbody>
        <tr><th scope="row">Flat</th><td>25–50장<br /><small>필터별</small></td><td>같은 초점·조리개·카메라 방향·광학계로 균일한 빛을 촬영. ISO/Gain을 유지하고 밝기가 포화되지 않게 노출을 조절합니다.</td></tr>
        <tr><th scope="row">Dark</th><td>20–50장<br /><small>노출·감도·온도 조합별</small></td><td>빛을 완전히 막고 Light와 같은 노출·ISO/Gain·Offset·온도로 촬영. 조건이 일치하는 라이브러리는 재사용할 수 있습니다.</td></tr>
        <tr><th scope="row">Bias</th><td>50–100장<br /><small>사용하는 보정 방식에 따라</small></td><td>빛을 막고 같은 ISO/Gain·Offset에서 카메라의 가장 짧은 노출로 촬영. 일부 CMOS는 Bias 대신 Dark-flat이 적합합니다.</td></tr>
        <tr><th scope="row">Dark-flat</th><td>25–50장<br /><small>Flat 조건별</small></td><td>빛을 막고 Flat와 같은 노출·ISO/Gain·Offset·온도로 촬영. Bias와 함께 무조건 적용하지 말고 센서·처리 소프트웨어의 보정 방식을 따릅니다.</td></tr>
      </tbody></table></div>
      <p className={styles.hint}>보정 프레임 수는 Light 장수와 1:1로 맞추지 않습니다. 모노의 Flat은 필터별로, Dark는 필터보다 노출·감도·온도 조합별로 준비하세요.</p>
    </section>
    <section className={styles.targetTip}><h5>이 대상의 촬영 포인트</h5><p>{guide.note}</p></section>
    <p className={styles.hint}>시험 촬영에서 초점·별 모양·중심 포화를 확인하고, 여러 장 사이 디더링으로 고정 무늬를 줄이세요. 은하·반사성운·먼지의 색은 달빛이 적은 어두운 하늘에서 확보하는 것이 유리합니다.</p>
  </div>;
}
