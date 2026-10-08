import { isFresh, usageSummary, WEATHER_PLANS, type WeatherLocation } from "@/lib/meteoblue";
import { weatherAt } from "@/lib/weather-evaluation";
import type { usePersonalWeather } from "./usePersonalWeather";
import type { useAutomaticSeeing } from "./useAutomaticSeeing";
import type { useAutomaticTerrain } from "./useAutomaticTerrain";
import styles from "./PersonalWeatherPanel.module.css";

type Props = {
  weather: ReturnType<typeof usePersonalWeather>;
  seeing: ReturnType<typeof useAutomaticSeeing>;
  location: WeatherLocation;
  locationName: string;
  observationTime: Date;
  modelSource: string;
  terrain: ReturnType<typeof useAutomaticTerrain>;
};

const number = (value: number) => value.toLocaleString("ko-KR");

export function PersonalWeatherPanel({ weather, seeing, terrain, location, locationName, observationTime, modelSource }: Props) {
  const { connected, busy, ledger, snapshot, plan } = weather;
  const usage = usageSummary(ledger, plan);
  const values = snapshot ? weatherAt(snapshot, observationTime) : null;
  const modifyNumber = (field: "budget" | "usedBeforeApp", raw: string) => {
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= 0) weather.updateLedger({ ...ledger, [field]: value, history: field === "usedBeforeApp" ? null : ledger.history });
  };

  return (
    <section className={styles.panel} aria-label="개인 Meteoblue 기상 자료">
      <div className={styles.heading}>
        <h2>관측 환경 자료</h2>
        <span className={connected ? styles.connected : styles.badge}>{connected ? "개인 키 연결됨" : "키 연결 전"}</span>
      </div>
      <div className={styles.links}>
        <a href="https://www.meteoblue.com/en/user/login/index" target="_blank" rel="noopener noreferrer">Meteoblue 로그인 ↗</a>
        <a href="https://www.meteoblue.com/en/user/account/index" target="_blank" rel="noopener noreferrer">API 키 발급·계정 ↗</a>
      </div>
      <p className={styles.help}>본인 계정에서 Weather API를 활성화하고 발급된 키를 붙여 넣으세요. 키는 새로고침하면 지워집니다.</p>
      <form className={styles.keyForm} onSubmit={(event) => { event.preventDefault(); void weather.applyKey(); }}>
        <label className={styles.srOnly} htmlFor="personal-weather-key">Meteoblue API 키</label>
        <input id="personal-weather-key" type="password" value={weather.keyInput} disabled={busy} autoComplete="off" spellCheck={false}
          placeholder={connected ? "다른 API 키 입력" : "개인 API 키 입력"} onChange={(event) => weather.setKeyInput(event.target.value)} />
        <button type="submit" disabled={busy || !weather.keyInput.trim()}>키 적용</button>
      </form>
      <p className={styles.help}>3시간 구성 · Meteoblue에서 AOD·구름량·운저를 조회합니다.</p>
      <div className={styles.target}>
        <span>선택한 한 장소</span><strong>{locationName}</strong>
        <small>{location.latitude.toFixed(4)}°, {location.longitude.toFixed(4)}°</small>
        <small role="status" aria-live="polite" title={seeing.message}>시상 {seeing.loading ? "불러오는 중…" : seeing.label ?? "자료 없음"}</small>
        {terrain.enabled && <small role="status" aria-live="polite">{terrain.message}
          {terrain.state === "error" && <button type="button" onClick={terrain.retry}>다시 시도</button>}
        </small>}
      </div>
      <button className={styles.load} type="button" disabled={!connected || busy} onClick={() => void weather.load()}>
        {busy ? "처리 중…" : snapshot && isFresh(snapshot) ? "저장 자료 불러오기 · 차감 없음" : "선택한 장소 불러오기"}
      </button>
      <p className={styles.help}>새 조회: 예상 {number(WEATHER_PLANS[plan].credits)} 크레딧 · 같은 장소의 24시간 이내 자료는 무료 재사용</p>
      <div className={styles.usage} aria-label="크레딧 사용량">
        <span>남은 예상 조회 횟수</span>
        <strong data-testid="remaining-loads">{number(usage.remainingLoads)} <small>/ {number(usage.totalLoads)}</small></strong>
        <div className={styles.track}><div style={{ width: `${ledger.budget ? Math.min(100, usage.remaining / ledger.budget * 100) : 0}%` }} /></div>
        <span>{number(usage.remaining)} / {number(ledger.budget)} 크레딧</span>
        <small>사용: {number(usage.used)} 크레딧 · {ledger.history ? "전일까지 계정 내역 + 이후 이 기기 기록" : "이 기기 기록 + 직접 입력한 기존 사용량"}</small>
        <small>실제 잔액·만료일은 Meteoblue 계정에서 확인하세요. 다른 기기와 앱의 오늘 사용량은 포함되지 않을 수 있습니다.</small>
        {usage.estimated && <small>일부 응답에 차감 헤더가 없어 공식 패키지 가격으로 추정했습니다.</small>}
        {usage.uncertain && <small className={styles.warning}>실패한 요청의 차감 여부가 불명확합니다. 계정 사용 내역을 확인하세요.</small>}
      </div>
      <p className={styles.message} role="status" aria-live="polite">{weather.message}</p>
      {snapshot && (
        <div className={styles.data}>
          <strong>{isFresh(snapshot) ? "저장 기상 자료" : "24시간이 지난 저장 자료"}</strong>
          <small>받은 시각: {new Date(snapshot.fetchedAt).toLocaleString("ko-KR")}</small>
          <small>관측 시각: {observationTime.toLocaleString("ko-KR")}</small>
          <div>구름량 {values?.cloudCover === null ? "자료 없음" : `${values?.cloudCover.toFixed(0)}%`}</div>
          <div>AOD {values?.aod === null ? "자료 없음" : values?.aod.toFixed(3)}</div>
          {snapshot.results.filter((result) => result.error).map((result) => <small className={styles.warning} key={result.package}>{result.package}: {result.error}</small>)}
          <small>{modelSource}</small>
          <button className={styles.secondary} type="button" disabled={busy || !connected} onClick={() => void weather.load(true)}>새 자료 요청 · 크레딧 사용</button>
        </div>
      )}
      {!snapshot && <p className={styles.help}>{modelSource}</p>}
      {(weather.storageWarning || seeing.storageWarning) && <p className={styles.warning}>브라우저 저장 공간을 사용할 수 없습니다. 현재 화면에서는 사용할 수 있지만, 창을 닫으면 저장 자료나 사용 기록이 사라질 수 있습니다.</p>}
      <details className={styles.settings}>
        <summary>크레딧 기준과 계정 사용량 설정</summary>
        <label className={styles.field}><span>총 제공 크레딧 (계정에서 확인)</span><input type="number" min="0" step="1" disabled={busy} value={ledger.budget} onChange={(event) => modifyNumber("budget", event.target.value)} /></label>
        <label className={styles.field}><span>이미 사용한 크레딧 (앱 사용 이전)</span><input type="number" min="0" step="1" disabled={busy} value={ledger.usedBeforeApp} onChange={(event) => modifyNumber("usedBeforeApp", event.target.value)} /></label>
        <label className={styles.field}><span>계정 사용 내역 조회 시작일</span><input type="date" disabled={busy} value={ledger.activationDate} onChange={(event) => weather.updateLedger({ ...ledger, activationDate: event.target.value, history: null })} /></label>
        <button className={styles.secondary} type="button" disabled={busy || !connected} onClick={() => void weather.syncUsage()}>전일까지 계정 사용량 동기화</button>
        <p className={styles.help}>시작일을 API 활성화 날짜로 맞추세요. 동기화 후에는 ‘이미 사용한 크레딧’ 대신 계정 사용 내역을 반영합니다. 남은 횟수는 3시간 구성의 비용으로 환산한 예상치입니다.</p>
        {connected && <button className={styles.secondary} type="button" disabled={busy} onClick={weather.disconnect}>API 키 연결 해제</button>}
      </details>
    </section>
  );
}
