import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { CameraSettings, EyepieceSettings, ObservationFilter, TelescopeSettings } from "./types";
import type { EquipmentSettings } from "./equipmentSettings";
import { EquipmentPresetsPanel } from "./EquipmentPresetsPanel";
import { DATA_SOURCE_GROUPS } from "./dataSources";
import { CameraSettingsPanel } from "./CameraSettingsPanel";
import { FilterSettingsPanel } from "./FilterSettingsPanel";
import styles from "./SettingsWindow.module.css";
import { BackgroundSettingsPanel } from "./BackgroundSettingsPanel";
import type { BackgroundController } from "./useBackgrounds";
import { ImagingGuidePanel } from "./ImagingGuidePanel";

const SETTINGS_TABS = [
  { id: "telescope", label: "망원경 설정" },
  { id: "camera", label: "카메라 설정" },
  { id: "filter", label: "필터 설정" },
  { id: "background", label: "배경 설정" },
  { id: "deepSky", label: "딥스카이별 촬영 세팅 정보" },
  { id: "sources", label: "출처" },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

type SettingsWindowProps = {
  id: string;
  backgrounds: BackgroundController;
  onShowGround: () => void;
  telescopeSettings: TelescopeSettings;
  cameraSettings: CameraSettings;
  eyepieceSettings: EyepieceSettings;
  onEyepieceSettingsChange: (settings: EyepieceSettings) => void;
  selectedFilter: ObservationFilter | null;
  onCameraSettingsChange: (settings: CameraSettings) => void;
  onFilterChange: (filter: ObservationFilter | null) => void;
  onEquipmentApply: (settings: EquipmentSettings) => void;
  onTelescopeSettingsChange: (settings: TelescopeSettings) => void;
  onTelescopeSettingsSave: () => void;
  onClose: () => void;
};

export function SettingsWindow({
  id,
  backgrounds,
  onShowGround,
  telescopeSettings,
  cameraSettings,
  eyepieceSettings,
  onEyepieceSettingsChange,
  selectedFilter,
  onCameraSettingsChange,
  onFilterChange,
  onEquipmentApply,
  onTelescopeSettingsChange,
  onTelescopeSettingsSave,
  onClose,
}: SettingsWindowProps) {
  const labelId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("telescope");
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();

    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = (index + 1) % SETTINGS_TABS.length;
        break;
      case "ArrowUp":
        nextIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = SETTINGS_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    setActiveTab(SETTINGS_TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  function updateTelescopeSetting(key: keyof TelescopeSettings, value: string) {
    const parsed = Number(value);
    onTelescopeSettingsChange({
      ...telescopeSettings,
      [key]: Number.isFinite(parsed) ? Math.max(1, parsed) : 1,
    });
    setSaveState("idle");
  }

  return (
    <dialog
      id={id}
      ref={dialogRef}
      className={`${styles.window} ${activeTab === "background" ? styles.backgroundWindow : ""} ${activeTab === "deepSky" ? styles.imagingWindow : ""}`}
      aria-labelledby={labelId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.titleBar}>
        <h2 id={labelId}>설정</h2>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="설정 창 닫기" title="닫기">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.tabs} role="tablist" aria-label="설정 항목" aria-orientation="vertical">
          {SETTINGS_TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[index] = element; }}
              id={`${id}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`${id}-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {SETTINGS_TABS.map((tab) => (
          <section
            key={tab.id}
            id={`${id}-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${tab.id}`}
            hidden={activeTab !== tab.id}
            tabIndex={0}
            className={`${styles.content} ${tab.id === "deepSky" ? styles.imagingContent : ""}`}
          >
            <h3>{tab.label}</h3>
            {tab.id === "deepSky" && <ImagingGuidePanel telescope={telescopeSettings} />}
            {tab.id === "background" && <BackgroundSettingsPanel backgrounds={backgrounds} onShowGround={onShowGround} />}
            {tab.id === "camera" && <CameraSettingsPanel settings={cameraSettings} onChange={onCameraSettingsChange} onSave={onTelescopeSettingsSave} />}
            {tab.id === "filter" && <FilterSettingsPanel selectedFilter={selectedFilter} onChange={onFilterChange} onSave={onTelescopeSettingsSave} />}
            {tab.id === "sources" && (
              <div className={styles.sourceGroups}>
                {typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname) && (
                  <a href="http://127.0.0.1:3004/" target="_blank" rel="noopener noreferrer">
                    로컬 API·연구 자료 연결 설정 ↗
                  </a>
                )}
                {DATA_SOURCE_GROUPS.map((group) => (
                  <section key={group.title} className={styles.sourceGroup}>
                    <h4>{group.title}</h4>
                    <ul>
                      {group.sources.map((source) => (
                        <li key={source.url}>
                          <a href={source.url} target="_blank" rel="noopener noreferrer">
                            {source.name} <span aria-hidden="true">↗</span>
                          </a>
                          <p>{source.description}</p>
                          {source.credit && <p>{source.credit}</p>}
                          {source.notice && (
                            <a className={styles.sourceNotice} href={source.notice.url} target="_blank" rel="noopener noreferrer">
                              {source.notice.label}
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {tab.id === "telescope" && (
              <div className={styles.telescopeSettings}>
                <div className={styles.fields}>
                  <label>
                    <span>초점거리(mm)</span>
                    <input
                      type="number"
                      min={1}
                      step={10}
                      value={telescopeSettings.focalLengthMm}
                      onChange={(event) => updateTelescopeSetting("focalLengthMm", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>구경(mm)</span>
                    <input
                      type="number"
                      min={1}
                      step={5}
                      value={telescopeSettings.apertureMm}
                      onChange={(event) => updateTelescopeSetting("apertureMm", event.target.value)}
                    />
                  </label>
                </div>
                <h4>접안렌즈</h4>
                <div className={styles.fields}>
                  {([{ key: "focalLengthMm", label: "접안렌즈 초점거리(mm)" }, { key: "apparentFieldDegrees", label: "겉보기 시야각(°)" }] as const).map(({ key, label }) => (
                    <label key={key}><span>{label}</span><input type="number" min={0.001} max={key === "apparentFieldDegrees" ? 180 : undefined} step="any"
                      value={eyepieceSettings[key] ?? ""} onChange={event => {
                        const value = event.target.value === "" ? null : Number(event.target.value);
                        onEyepieceSettingsChange({ ...eyepieceSettings, [key]: value }); setSaveState("idle");
                      }} /></label>
                  ))}
                </div>
                <p>겉보기 시야각은 접안렌즈 제품 사양에 적힌 값입니다. 두 값을 입력하면 배율과 원형 화각을 계산합니다.</p>
                <button
                  type="button"
                  className={styles.saveButton}
                  onClick={() => {
                    try { onTelescopeSettingsSave(); setSaveState("saved"); }
                    catch { setSaveState("error"); }
                  }}
                >
                  {saveState === "saved" ? "저장됨" : "설정 저장"}
                </button>
                {saveState === "error" && <p className={styles.saveError} role="alert">설정을 저장하지 못했습니다. 저장 공간을 확인해 주세요.</p>}
                <EquipmentPresetsPanel equipment={{ telescope: telescopeSettings, camera: cameraSettings, eyepiece: eyepieceSettings, filter: selectedFilter }} onApply={onEquipmentApply} />
              </div>
            )}
          </section>
        ))}
      </div>
    </dialog>
  );
}
