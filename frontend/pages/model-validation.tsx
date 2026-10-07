import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import { useEffect, useRef, useState } from "react";
import { getLunarContext } from "@/components/SkyViewer/coordinates";
import { addDataSource, getEngineModule, loadStellariumScript, patchWasmMemoryHelpers } from "@/components/SkyViewer/engineControls";
import type { StellariumEngine } from "@/components/SkyViewer/types";
import { accountedCredits, cacheKey, isFresh, modelResponses, recordSnapshot, validKey, type WeatherSnapshot } from "@/lib/meteoblue";
import { keyFingerprint, readLedger, readWeather, saveLedger, saveWeather } from "@/lib/weather-storage";

// This research tool is available only on a local development server.
export const getServerSideProps: GetServerSideProps = async ({ req }) => {
  const host = req.headers.host ?? "";
  if (process.env.NODE_ENV !== "development" || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return { notFound: true };
  return { props: {} };
};

const SITES = [
  { name: "서울 도심", latitude: 37.5665, longitude: 126.978 },
  { name: "제주 중산간", latitude: 33.35, longitude: 126.55 },
  { name: "설악산 일대", latitude: 38.119, longitude: 128.465 },
  { name: "산티아고", latitude: -33.4489, longitude: -70.6693 },
  { name: "마우나케아 일대", latitude: 19.8206, longitude: -155.4681 },
  { name: "트롬쇠", latitude: 69.6492, longitude: 18.9553 },
];
type Site = typeof SITES[number];
type Sample = { datetime: string; moonAltitude: number; moonAzimuth: number; moonPhaseAngle: number; result: Record<string, unknown> };
type Row = { site: Site; cache: boolean; credits: number; estimated: boolean; cacheSaved: boolean; packages: string[]; samples: Sample[]; error?: string };

function nightTimes(date: string, longitude: number) {
  // Approximate local solar 21:00, 00:00 and 03:00. Explicit UTC times are
  // sent through the same +09:00 weather parsing path used by the main app.
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return [21, 24, 27].map((hour) => new Date(midnight + (hour - longitude / 15) * 3_600_000));
}
function textNumber(value: unknown, digits = 3) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}
function fullModel(sample: Sample) {
  return sample.result.source === "black-marble-dem" && sample.result.assetsReady === true;
}

export default function ModelValidation() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<StellariumEngine | null>(null);
  const accountKey = useRef("");
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [selected, setSelected] = useState(SITES.map(() => true));
  const [date, setDate] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("달 위치 계산 엔진 준비 중…");
  const [rows, setRows] = useState<Row[]>([]);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDate(new Date().toISOString().slice(0, 10));
    void (async () => {
      try {
        await loadStellariumScript();
        if (!active || !canvas.current || !window.StelWebEngine) return;
        const value = await window.StelWebEngine({ canvasElement: canvas.current, res: [], wasmFile: "/stellarium/stellarium-web-engine.wasm" });
        if (!active) return;
        patchWasmMemoryHelpers(value);
        const planets = getEngineModule(value, "planets");
        addDataSource(planets, "/stellarium/skydata/surveys/sso/moon", "moon");
        addDataSource(planets, "/stellarium/skydata/surveys/sso/sun", "sun");
        engine.current = value;
        if (!getLunarContext(value, new Date(), SITES[0])) throw new Error("moon unavailable");
        setEngineReady(true);
        setStatus("준비 완료 · 키를 입력한 뒤 검증을 시작하세요.");
      } catch {
        if (active) setStatus("달 위치 계산 엔진을 준비하지 못했습니다. 화면을 새로고침해 주세요.");
      }
    })();
    return () => { active = false; accountKey.current = ""; };
  }, []);

  async function run() {
    const apiKey = key.trim() || accountKey.current;
    if (running || !engine.current || !validKey(apiKey) || !date) return;
    accountKey.current = apiKey;
    setHasKey(true);
    setKey("");
    setRunning(true);
    setRows([]);
    setFinishedAt(null);
    const results: Row[] = [];
    try {
      const fingerprint = await keyFingerprint(apiKey);
      for (const [index, site] of SITES.entries()) {
        if (!selected[index]) continue;
        setStatus(`${site.name} · 저장 기상 확인 중…`);
        const location = { latitude: site.latitude, longitude: site.longitude };
        const storageKey = cacheKey(fingerprint, "free3h", location);
        const cached = await readWeather(storageKey);
        const fromCache = !!cached && isFresh(cached);
        let snapshot: WeatherSnapshot;
        if (fromCache) snapshot = cached!;
        else {
          setStatus(`${site.name} · 기상 3개 패키지 조회 중…`);
          const response = await fetch("/api/meteoblue/weather", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey, location, plan: "free3h" }),
          });
          if (!response.ok) throw new Error("기상 서버 요청 실패. 자동으로 재시도하지 않았습니다.");
          snapshot = await response.json() as WeatherSnapshot;
          saveLedger(fingerprint, recordSnapshot(readLedger(fingerprint), snapshot));
        }
        const row: Row = { site, cache: fromCache, credits: fromCache ? 0 : accountedCredits(snapshot.results),
          estimated: !fromCache && snapshot.results.some((item) => item.creditSource !== "header"),
          cacheSaved: fromCache || await saveWeather(storageKey, snapshot),
          packages: snapshot.results.map((item) => `${item.package}: ${item.error || "수신 완료"}`), samples: [] };
        results.push(row);
        if (snapshot.results.some((item) => item.error || !item.data)) {
          row.error = "일부 패키지 조회 실패. 추가 차감을 막기 위해 검증을 중단했습니다.";
          setRows([...results]);
          break;
        }
        for (const time of nightTimes(date, site.longitude)) {
          setStatus(`${site.name} · ${time.toISOString()} 계산 중…`);
          const astronomy = getLunarContext(engine.current, time, location);
          if (!astronomy) throw new Error("달 위치 계산 실패. 해당 시각 결과를 만들지 않았습니다.");
          const response = await fetch("/api/research/evaluate", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ location, datetime: time.toISOString(), altitude: 45, azimuth: 180,
              responses: modelResponses(snapshot), astronomy }),
          });
          if (!response.ok) throw new Error("저장 자료 계산 실패. 계산 서버 연결을 확인해 주세요.");
          row.samples.push({ datetime: time.toISOString(), moonAltitude: astronomy.altitude,
            moonAzimuth: astronomy.azimuth, moonPhaseAngle: astronomy.phaseAngle, result: await response.json() });
          setRows([...results]);
        }
      }
      setFinishedAt(new Date().toISOString());
      const count = results.flatMap((row) => row.samples).filter(fullModel).length;
      const expected = selected.filter(Boolean).length * 3;
      setStatus(count === expected ? `검증 완료 · ${count}/${expected}개 시점에서 전체 모델 계산` : `검증 종료 · ${count}/${expected}개 시점에서 전체 모델 계산. 결측·오류를 확인하세요.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "검증을 완료하지 못했습니다.");
    } finally { setRunning(false); }
  }

  function downloadReport() {
    const report = { kind: "actual-forecast-integration", finishedAt, observationDate: date,
      direction: { altitude: 45, azimuth: 180 }, rows,
      limitations: "예보·저장 자료·달 위치 연결 검증입니다. 현장 측정에 대한 정확도 검증이 아닙니다." };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `model-validation-${date}.json`; link.click();
    URL.revokeObjectURL(url);
  }

  const siteCount = selected.filter(Boolean).length;
  const samples = rows.flatMap((row) => row.samples);
  return <>
    <Head><title>지역별 연구 모델 검증</title></Head>
    <main>
      <header><div><p className="eyebrow">LOCAL RESEARCH</p><h1>지역별 연구 모델 검증</h1>
        <p>저장된 지형·야간광에 실제 기상과 달 위치를 연결합니다.</p></div>
        <Link href="/">관측 화면으로</Link></header>
      <section className="setup">
        <label>개인 Meteoblue API 키<input type="password" autoComplete="off" value={key} disabled={running}
          onChange={(event) => setKey(event.target.value)} placeholder={hasKey ? "이 화면 메모리에 연결됨" : "키는 채팅에 보내지 마세요"} /></label>
        <label>관측 날짜<input type="date" value={date} disabled={running} onChange={(event) => setDate(event.target.value)} /></label>
        <fieldset disabled={running}><legend>시험 장소</legend>{SITES.map((site, index) => <label className="choice" key={site.name}>
          <input type="checkbox" checked={selected[index]} onChange={(event) => setSelected((previous) => previous.map((item, i) => i === index ? event.target.checked : item))} />{site.name}
        </label>)}</fieldset>
        <p className="note">24시간 이내 저장 기상을 우선 사용합니다. 새 조회는 장소당 3개 패키지이며,
          선택한 {siteCount}개 장소의 예상 차감 상한은 {(siteCount * 24_000).toLocaleString()} 크레딧입니다(현재 단가 추정).
          시간별 계산은 추가 기상 조회를 하지 않습니다. 키는 이 화면의 메모리에만 유지됩니다.</p>
        <div className="actions"><button onClick={run} disabled={running || !engineReady || !(validKey(key.trim()) || hasKey) || !siteCount || !date}>
          {running ? "검증 중…" : "선택한 지역 검증 시작"}</button>
          <button className="secondary" onClick={downloadReport} disabled={running || !samples.length}>결과 JSON 저장</button></div>
        <p role="status" className="status">{status}</p>
        <canvas ref={canvas} width={32} height={32} className="engine" aria-hidden="true" />
      </section>
      {!!rows.length && <section><h2>검증 결과</h2><p className="note">각 장소의 태양시 약 21시·0시·3시, 고도 45°·방위각 180°를 비교합니다. 아래 시각은 UTC입니다.</p>
        <p>전체 모델 계산 {samples.filter(fullModel).length}/{samples.length} · 이번 조회 차감 {rows.reduce((sum, row) => sum + row.credits, 0).toLocaleString()}
          {rows.some((row) => row.estimated) && " (일부 추정)"}</p>
        {rows.map((row) => <article key={row.site.name}><h3>{row.site.name} <span>{row.cache ? "저장 기상 재사용" : "새 기상 조회"}</span></h3>
          <p className="note">{row.site.latitude}, {row.site.longitude} · {row.credits.toLocaleString()} 크레딧 · {row.cacheSaved ? "기상 저장됨" : "기상 영구 저장 실패"}</p>
          {row.error && <p className="error">{row.error}</p>}
          <div className="scroll"><table><thead><tr><th>시각 (UTC)</th><th>계산 경로</th><th>SQM</th><th>AOD</th><th>구름 (%)</th><th>달 고도 (°)</th><th>야간광 픽셀</th><th>결측 항목</th></tr></thead>
            <tbody>{row.samples.map((sample) => {
              const environment = sample.result.environment as Record<string, unknown> | null;
              const missing = sample.result.missing as string[];
              return <tr key={sample.datetime}><td>{sample.datetime.slice(5,16).replace("T", " ")}</td>
                <td className={fullModel(sample) ? "pass" : "error"}>{fullModel(sample) ? "전체 모델" : "간이 추정"}</td>
                <td>{textNumber(sample.result.sqm)}</td><td>{textNumber(environment?.aod)}</td>
                <td>{textNumber(typeof environment?.cloudFraction === "number" ? environment.cloudFraction * 100 : null, 1)}</td>
                <td>{textNumber(sample.moonAltitude, 1)}</td><td>{String(sample.result.blackMarblePixelCount ?? "—")}</td><td>{missing?.join(", ") || "없음"}</td></tr>;
            })}</tbody></table></div>
          <details><summary>응답 상세</summary><pre>{JSON.stringify(row, null, 2)}</pre></details>
        </article>)}
      </section>}
      <footer>시험 좌표는 지역 비교용입니다. 예보와 저장 자료의 연결을 확인하며, 현장 측정에 대한 모델 정확도를 보증하지 않습니다.</footer>
    </main>
    <style jsx>{`
      :global(body) { margin: 0; background: #0b1120; color: #e7edf8; font-family: system-ui, sans-serif; }
      main { max-width: 1200px; margin: 0 auto; padding: 40px 24px; } header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 28px; }
      h1 { font-size: 28px; margin: 7px 0 12px; } h2 { font-size: 22px; } p { line-height: 1.65; } a { color: #9fc1ff; white-space: nowrap; }
      .eyebrow { color: #92b4f5; font-size: 11px; letter-spacing: .18em; margin: 0; } section { background: #141e30; border: 1px solid #2a3850; border-radius: 14px; padding: 24px; margin-bottom: 24px; }
      .setup { position: relative; } label { display: block; font-size: 14px; margin-bottom: 18px; } input[type=password], input[type=date] { display: block; box-sizing: border-box; width: min(100%, 500px); margin-top: 8px; padding: 12px; background: #0b1424; border: 1px solid #3c4f6e; border-radius: 7px; color: inherit; font: inherit; }
      fieldset { display: flex; flex-wrap: wrap; gap: 18px; border: 1px solid #33425c; border-radius: 8px; padding: 16px; } legend { font-size: 14px; padding: 0 6px; } .choice { display: flex; align-items: center; gap: 7px; margin: 0; }
      .note, footer { color: #aebcd2; font-size: 13px; } .actions { display: flex; gap: 12px; margin-top: 20px; } button { background: #5683df; color: white; border: 0; border-radius: 7px; padding: 12px 18px; font: inherit; cursor: pointer; } button.secondary { background: #2c3b54; } button:disabled { opacity: .4; cursor: default; }
      .status { color: #c8dcff; margin-bottom: 0; } .engine { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; } article { border-top: 1px solid #33425c; padding: 12px 0; } h3 span { color: #9fb2d2; font-size: 12px; font-weight: normal; margin-left: 10px; }
      .scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; white-space: nowrap; font-size: 13px; text-align: left; } th, td { padding: 12px 10px; border-bottom: 1px solid #293951; } th { color: #acbdd9; } .pass { color: #8bd8b1; } .error { color: #ffb5ae; } details { margin-top: 16px; font-size: 12px; color: #acbdd9; } pre { max-height: 320px; overflow: auto; } footer { margin-top: 30px; }
      @media(max-width:600px) { main { padding: 24px 12px; } section { padding: 18px; } h1 { font-size: 23px; } header { align-items: flex-start; } .actions { flex-wrap: wrap; } }
    `}</style>
  </>;
}
