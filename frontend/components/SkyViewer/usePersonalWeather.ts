import { useCallback, useEffect, useRef, useState } from "react";
import {
  cacheKey, isFresh, locationKey, newLedger, recordSnapshot, validKey,
  type CreditLedger, type WeatherLocation, type WeatherPlan, type WeatherSnapshot,
} from "@/lib/meteoblue";
import { keyFingerprint, readLedger, readWeather, saveLedger, saveWeather } from "@/lib/weather-storage";
import { credentials } from "@/lib/personal-settings";

export function usePersonalWeather(location: WeatherLocation) {
  const [keyInput, setKeyInput] = useState("");
  const [account, setAccount] = useState<{ key: string; fingerprint: string } | null>(null);
  const plan: WeatherPlan = "free3h";
  const [ledger, setLedger] = useState<CreditLedger>(newLedger);
  const ledgerRef = useRef(ledger);
  const [stored, setStored] = useState<{ key: string; snapshot: WeatherSnapshot } | null>(null);
  const [busy, setBusy] = useState(true);
  const busyRef = useRef(true);
  const [message, setMessage] = useState("Meteoblue에서 발급한 개인 API 키를 입력하세요.");
  const [storageWarning, setStorageWarning] = useState(false);
  const currentCacheKey = account ? cacheKey(account.fingerprint, plan, location) : "";
  const snapshot = stored?.key === currentCacheKey ? stored.snapshot : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const key = await credentials().read();
        if (!key || cancelled) return;
        if (!validKey(key)) throw new Error("Invalid saved credential");
        const fingerprint = await keyFingerprint(key);
        if (cancelled) return;
        const value = readLedger(fingerprint);
        ledgerRef.current = value; setLedger(value); setAccount({ key, fingerprint });
        setMessage("저장한 API 키를 복원했습니다. 저장 기상 자료를 확인하며 새 조회는 불러오기 버튼으로 요청합니다.");
      } catch {
        if (!cancelled) setMessage("저장한 API 키를 복원하지 못했습니다. 키를 다시 입력해 주세요.");
      } finally { if (!cancelled) { busyRef.current = false; setBusy(false); } }
    })();
    return () => { cancelled = true; };
  }, []);

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
      try {
        await credentials().save(key);
        setMessage("키 적용·저장 완료. 앱을 다시 켜도 복원됩니다. 장소를 정하고 ‘불러오기’를 누르면 조회합니다.");
      } catch { setMessage("키는 적용했지만 저장하지 못했습니다. 이번 실행에서만 사용할 수 있습니다."); }
    } catch { setMessage("키를 적용하지 못했습니다. HTTPS 또는 localhost로 접속하세요."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function disconnect() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      await credentials().clear();
      setAccount(null); setKeyInput(""); setStored(null);
      const value = newLedger(); ledgerRef.current = value; setLedger(value);
      setMessage("키 연결을 해제하고 저장한 키를 삭제했습니다. 기상 자료와 사용 기록은 유지됩니다.");
    } catch { setMessage("저장한 키를 삭제하지 못했습니다. 연결 해제를 다시 시도해 주세요."); }
    finally { busyRef.current = false; setBusy(false); }
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
    plan, ledger, updateLedger, snapshot, busy, message, storageWarning,
    applyKey, disconnect, load, syncUsage, locationKey: locationKey(location) };
}
