import { useCallback, useEffect, useRef, useState } from "react";
import {
  cacheKey, isFresh, locationKey, newLedger, recordSnapshot, validKey,
  type CreditLedger, type WeatherLocation, type WeatherPlan, type WeatherSnapshot,
} from "@/lib/meteoblue";
import { keyFingerprint, readLedger, readWeather, saveLedger, saveWeather } from "@/lib/weather-storage";
import { readSeeing, saveSeeing } from "@/lib/weather-storage";
import { seeingCacheKey, seeingFresh, validSeeing, type SeeingSnapshot } from "@/lib/seeing";

export function usePersonalWeather(location: WeatherLocation) {
  const [keyInput, setKeyInput] = useState("");
  const [account, setAccount] = useState<{ key: string; fingerprint: string } | null>(null);
  const plan: WeatherPlan = "free3h";
  const [seeingStored, setSeeingStored] = useState<{ key: string; snapshot: SeeingSnapshot } | null>(null);
  const [seeingMessage, setSeeingMessage] = useState("3시간 간격 시상 예보를 무료로 조회합니다.");
  const publicCacheKey = seeingCacheKey(location);
  const seeingSnapshot = seeingStored?.key === publicCacheKey ? seeingStored.snapshot : null;
  const [ledger, setLedger] = useState<CreditLedger>(newLedger);
  const ledgerRef = useRef(ledger);
  const [stored, setStored] = useState<{ key: string; snapshot: WeatherSnapshot } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("Meteoblue에서 발급한 개인 API 키를 입력하세요.");
  const [storageWarning, setStorageWarning] = useState(false);
  const currentCacheKey = account ? cacheKey(account.fingerprint, plan, location) : "";
  const snapshot = stored?.key === currentCacheKey ? stored.snapshot : null;

  const updateLedger = useCallback((value: CreditLedger) => {
    ledgerRef.current = value;
    setLedger(value);
    if (account && !saveLedger(account.fingerprint, value)) setStorageWarning(true);
  }, [account]);

  useEffect(() => {
    let cancelled = false;
    if (currentCacheKey) void readWeather(currentCacheKey).then((value) => {
      if (!cancelled) setStored(value ? { key: currentCacheKey, snapshot: value } : null);
    });
    return () => { cancelled = true; };
  }, [currentCacheKey]);

  useEffect(() => {
    let cancelled = false;
    void readSeeing(publicCacheKey).then((value) => {
      if (!cancelled) setSeeingStored(value ? { key: publicCacheKey, snapshot: value } : null);
    });
    return () => { cancelled = true; };
  }, [publicCacheKey]);

  async function requestSeeing(capturedLocation: WeatherLocation, force = false) {
    const key = seeingCacheKey(capturedLocation);
    try {
      const cached = await readSeeing(key);
      if (!force && cached && seeingFresh(cached)) {
        setSeeingStored({ key, snapshot: cached });
        setSeeingMessage("저장한 시상 예보를 재사용했습니다. 크레딧 차감 없음.");
        return;
      }
      setSeeingMessage("시상 예보를 불러오는 중입니다…");
      const response = await fetch("/api/seeing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: capturedLocation }) });
      const value: unknown = await response.json();
      if (!response.ok || !validSeeing(value) || locationKey(value.location) !== locationKey(capturedLocation)) throw new Error("seeing unavailable");
      setSeeingStored({ key, snapshot: value });
      if (!await saveSeeing(key, value)) setStorageWarning(true);
      setSeeingMessage("시상 예보를 이 브라우저에 저장했습니다. 크레딧 차감 없음.");
    } catch { setSeeingMessage("시상 예보를 받지 못했습니다. 저장 자료는 유지됩니다. 잠시 후 다시 시도하세요."); }
  }

  async function loadSeeing(force = false) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await requestSeeing({ ...location }, force); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function applyKey() {
    if (busyRef.current) return;
    const key = keyInput.trim();
    if (!validKey(key)) { setMessage("발급받은 API 키를 확인하세요. 이메일이나 비밀번호는 입력하지 않습니다."); return; }
    busyRef.current = true;
    setBusy(true);
    try {
      const fingerprint = await keyFingerprint(key);
      const value = readLedger(fingerprint);
      ledgerRef.current = value;
      setLedger(value);
      setAccount({ key, fingerprint });
      setKeyInput("");
      setMessage("키 적용 완료. 장소를 정하고 ‘불러오기’를 누르면 조회합니다.");
    } catch { setMessage("키를 적용하지 못했습니다. HTTPS 또는 localhost로 접속하세요."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function disconnect() {
    if (busyRef.current) return;
    setAccount(null); setKeyInput(""); setStored(null);
    const value = newLedger(); ledgerRef.current = value; setLedger(value);
    setMessage("키 연결을 해제했습니다. 저장 자료와 사용 기록은 이 브라우저에 유지됩니다.");
  }

  async function load(force = false) {
    if (!account || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const key = currentCacheKey;
    const capturedLocation = { ...location };
    try {
      const cached = await readWeather(key);
      if (!force && cached && isFresh(cached)) {
        setStored({ key, snapshot: cached });
        setMessage("24시간 이내 저장 자료를 불러왔습니다. 크레딧 차감 없음.");
        return;
      }
      setMessage("선택한 장소 한 곳의 기상 자료를 요청하고 있습니다…");
      // Do not abort a paid request when the observation direction/time changes.
      const response = await fetch("/api/meteoblue/weather", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: account.key, location: capturedLocation, plan }),
      });
      if (!response.ok) throw new Error("weather request failed");
      const value: WeatherSnapshot = await response.json();
      updateLedger(recordSnapshot(ledgerRef.current, value));
      const available = value.results.filter((result) => result.data);
      if (available.length) {
        setStored({ key, snapshot: value });
        if (!await saveWeather(key, value)) setStorageWarning(true);
        setMessage(available.length === value.results.length ? "자료를 불러와 이 브라우저에 저장했습니다." : "일부 패키지만 받았습니다. 누락 내용과 차감 크레딧을 확인하세요.");
      } else {
        setMessage(value.results.map((result) => `${result.package}: ${result.error}`).join(" "));
      }
    } catch {
      setMessage("요청 결과를 확인하지 못했습니다. 재요청 전 계정의 사용량을 확인하세요. 저장 자료는 유지됩니다.");
    } finally {
      // Public seeing data remains independent of Meteoblue permissions and credits.
      await requestSeeing(capturedLocation, force);
      busyRef.current = false; setBusy(false);
    }
  }

  async function syncUsage() {
    if (!account || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const response = await fetch("/api/meteoblue/usage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: account.key, start: ledgerRef.current.activationDate }),
      });
      const payload = await response.json();
      if (!response.ok) { setMessage(payload.error); return; }
      updateLedger({ ...ledgerRef.current, history: payload });
      setMessage("전일까지 계정 사용량을 반영했습니다. 오늘은 이 기기에서 조회한 크레딧을 더해 계산합니다.");
    } catch { setMessage("사용량 동기화에 실패했습니다. 기존 사용 기록은 유지됩니다."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return { keyInput, setKeyInput, connected: !!account, fingerprint: account?.fingerprint ?? null,
    plan, ledger, updateLedger, snapshot, seeingSnapshot, seeingMessage, busy, message, storageWarning,
    applyKey, disconnect, load, loadSeeing, syncUsage, locationKey: locationKey(location) };
}
