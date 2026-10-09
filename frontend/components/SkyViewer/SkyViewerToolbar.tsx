import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./SkyViewer.module.css";
import type { CameraSettings, EyepieceSettings, ObservationFilter, TelescopeSettings } from "./types";
import type { EquipmentSettings } from "./equipmentSettings";
import { SettingsWindow } from "./SettingsWindow";
import type { BackgroundController } from "./useBackgrounds";

export type DisplayToggleName =
  | "horizontalCoordinates"
  | "equatorialCoordinates"
  | "constellationLines"
  | "equator"
  | "ecliptic"
  | "atmosphere"
  | "ground";

export type DisplayToggles = Record<DisplayToggleName, boolean>;

type ToolbarIconName =
  | "constellation"
  | "horizontal"
  | "atmosphere"
  | "ground"
  | "deepSky"
  | "fieldOfView"
  | "eyepieceFieldOfView"
  | "difficultyInfo"
  | "settings";

type SkyViewerToolbarProps = {
  backgrounds: BackgroundController;
  onShowGround: () => void;
  deepSkyMode: boolean;
  telescopeSettings: TelescopeSettings;
  cameraSettings: CameraSettings;
  eyepieceSettings: EyepieceSettings;
  onEyepieceSettingsChange: (settings: EyepieceSettings) => void;
  eyepieceFieldOfViewStage: number;
  eyepieceFieldOfViewLabel: string;
  eyepieceFieldOfViewMessage: string;
  onEyepieceFieldOfViewToggle: () => void;
  selectedFilter: ObservationFilter | null;
  onCameraSettingsChange: (settings: CameraSettings) => void;
  onFilterChange: (filter: ObservationFilter | null) => void;
  onEquipmentApply: (settings: EquipmentSettings) => void;
  fieldOfViewStage: number;
  fieldOfViewLabel: string;
  fieldOfViewMessage: string;
  onFieldOfViewToggle: () => void;
  onFieldOfViewMessageDismiss: () => void;
  toggles: DisplayToggles;
  isEngineReady: boolean;
  onDeepSkyModeToggle: () => void;
  onTelescopeSettingsSave: () => void;
  onTelescopeSettingsChange: (settings: TelescopeSettings) => void;
  onToggle: (name: DisplayToggleName, enabled?: boolean) => void;
};

const COORDINATE_OPTIONS: { name: DisplayToggleName; label: string }[] = [
  { name: "horizontalCoordinates", label: "지평좌표" },
  { name: "equatorialCoordinates", label: "적도좌표" },
];

const LINE_OPTIONS: { name: DisplayToggleName; label: string }[] = [
  { name: "constellationLines", label: "별자리선" },
  { name: "equator", label: "적도" },
  { name: "ecliptic", label: "황도" },
];

function DisplayOptionsMenu({
  label,
  icon,
  options,
  toggles,
  isOpen,
  isEngineReady,
  onOpenToggle,
  onClose,
  onToggle,
}: {
  label: string;
  icon: ToolbarIconName;
  options: { name: DisplayToggleName; label: string }[];
  toggles: DisplayToggles;
  isOpen: boolean;
  isEngineReady: boolean;
  onOpenToggle: () => void;
  onClose: () => void;
  onToggle: SkyViewerToolbarProps["onToggle"];
}) {
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isActive = options.some((option) => toggles[option.name]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div
      className={styles.toolbarSettingsWrapper}
      ref={wrapperRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={isActive || isOpen ? styles.active : ""}
        onClick={onOpenToggle}
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        title={label}
      >
        <ToolbarIcon name={icon} />
      </button>
      {isOpen && (
        <section id={menuId} className={styles.toolbarLineMenu} aria-label={label}>
          {options.map((option) => (
            <label key={option.name}>
              <input
                type="checkbox"
                checked={toggles[option.name]}
                disabled={!isEngineReady}
                onChange={(event) => onToggle(option.name, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </section>
      )}
    </div>
  );
}

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  if (name === "eyepieceFieldOfView") {
    return <svg className={styles.coordinateToolbarIcon} viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17" /><path d="M20 24h8M24 20v8" /></svg>;
  }
  if (name === "fieldOfView") {
    return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 11h34v26H7Z" /><path d="M20 24h8M24 20v8" /></svg>;
  }
  if (name === "constellation") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M9 36 17 12 32 18 39 35 23 39Z" />
        <circle cx="9" cy="36" r="4" />
        <circle cx="17" cy="12" r="4" />
        <circle cx="32" cy="18" r="4" />
        <circle cx="39" cy="35" r="4" />
        <circle cx="23" cy="39" r="4" />
      </svg>
    );
  }

  if (name === "horizontal") {
    return (
      <svg className={styles.coordinateToolbarIcon} viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="18" />
        <path d="M6 24h36M24 6c5 5 7.5 11 7.5 18S29 37 24 42M24 6c-5 5-7.5 11-7.5 18S19 37 24 42M10.5 14.5h27M10.5 33.5h27" />
      </svg>
    );
  }

  if (name === "atmosphere") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M14 34h23a8 8 0 0 0 0-16 12 12 0 0 0-23-3 9.5 9.5 0 0 0 0 19Z" />
      </svg>
    );
  }

  if (name === "ground") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M5 35c7-10 13-13 19-8 5-8 12-10 19 8" />
        <path d="M7 36h34" />
        <circle cx="34" cy="15" r="5" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24.4 4h-.8a4 4 0 0 0-4 4v.3a4 4 0 0 1-2 3.5l-.8.4a4 4 0 0 1-4 0l-.3-.2a4 4 0 0 0-5.5 1.5l-.4.7a4 4 0 0 0 1.5 5.5l.3.2a4 4 0 0 1 2 3.5v1a4 4 0 0 1-2 3.5l-.3.2a4 4 0 0 0-1.5 5.5l.4.7a4 4 0 0 0 5.5 1.5l.3-.2a4 4 0 0 1 4 0l.8.4a4 4 0 0 1 2 3.5v.3a4 4 0 0 0 4 4h.8a4 4 0 0 0 4-4v-.3a4 4 0 0 1 2-3.5l.8-.4a4 4 0 0 1 4 0l.3.2a4 4 0 0 0 5.5-1.5l.4-.7a4 4 0 0 0-1.5-5.5l-.3-.2a4 4 0 0 1-2-3.5v-1a4 4 0 0 1 2-3.5l.3-.2a4 4 0 0 0 1.5-5.5l-.4-.7A4 4 0 0 0 35.5 12l-.3.2a4 4 0 0 1-4 0l-.8-.4a4 4 0 0 1-2-3.5V8a4 4 0 0 0-4-4Z" />
        <circle cx="24" cy="24" r="6" />
      </svg>
    );
  }

  if (name === "difficultyInfo") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="17" />
        <path d="M24 21v12" />
        <circle cx="24" cy="15" r="1.8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M39 14c-5-7-17-8-25-1 8-2 13 0 16 4-7-3-17 0-21 9 6-5 13-5 18-2-7 0-14 6-14 15 4-6 10-9 17-8 7 1 12-3 14-9-4 4-8 5-13 4 6-2 9-6 8-12Z" />
    </svg>
  );
}

export function SkyViewerToolbar({
  backgrounds,
  onShowGround,
  deepSkyMode,
  telescopeSettings,
  cameraSettings,
  eyepieceSettings,
  onEyepieceSettingsChange,
  eyepieceFieldOfViewStage,
  eyepieceFieldOfViewLabel,
  eyepieceFieldOfViewMessage,
  onEyepieceFieldOfViewToggle,
  selectedFilter,
  onCameraSettingsChange,
  onFilterChange,
  onEquipmentApply,
  fieldOfViewStage,
  fieldOfViewLabel,
  fieldOfViewMessage,
  onFieldOfViewToggle,
  onFieldOfViewMessageDismiss,
  toggles,
  isEngineReady,
  onDeepSkyModeToggle,
  onTelescopeSettingsSave,
  onTelescopeSettingsChange,
  onToggle,
}: SkyViewerToolbarProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDifficultyInfoOpen, setIsDifficultyInfoOpen] = useState(false);
  const [openLineMenu, setOpenLineMenu] = useState<"coordinates" | "lines" | null>(null);
  const closeLineMenu = useCallback(() => setOpenLineMenu(null), []);
  const settingsWindowId = useId();
  const closeSettingsWindow = useCallback(() => setIsSettingsOpen(false), []);

  return (
    <>
      <div className={styles.bottomToolbar} aria-label="표시 옵션">
        <DisplayOptionsMenu
          label="별자리선"
          icon="constellation"
          options={LINE_OPTIONS}
          toggles={toggles}
          isOpen={openLineMenu === "lines"}
          isEngineReady={isEngineReady}
          onOpenToggle={() => setOpenLineMenu((current) => current === "lines" ? null : "lines")}
          onClose={closeLineMenu}
          onToggle={onToggle}
        />
        <DisplayOptionsMenu
          label="좌표계"
          icon="horizontal"
          options={COORDINATE_OPTIONS}
          toggles={toggles}
          isOpen={openLineMenu === "coordinates"}
          isEngineReady={isEngineReady}
          onOpenToggle={() => setOpenLineMenu((current) => current === "coordinates" ? null : "coordinates")}
          onClose={closeLineMenu}
          onToggle={onToggle}
        />
        <button
          type="button"
          className={toggles.atmosphere ? styles.active : ""}
          onClick={() => onToggle("atmosphere")}
          aria-label={`대기 ${toggles.atmosphere ? "끄기" : "켜기"}`}
          aria-pressed={toggles.atmosphere}
          title={`대기 ${toggles.atmosphere ? "끄기" : "켜기"}`}
        >
          <ToolbarIcon name="atmosphere" />
        </button>
        <button
          type="button"
          className={toggles.ground ? styles.active : ""}
          onClick={() => onToggle("ground")}
          aria-label={`지평 ${toggles.ground ? "끄기" : "켜기"}`}
          aria-pressed={toggles.ground}
          title={`지평 ${toggles.ground ? "끄기" : "켜기"}`}
        >
          <ToolbarIcon name="ground" />
        </button>
        <button
          type="button"
          className={deepSkyMode ? styles.active : ""}
          onClick={onDeepSkyModeToggle}
          aria-label={`딥스카이 ${deepSkyMode ? "끄기" : "켜기"}`}
          aria-pressed={deepSkyMode}
          title={`딥스카이 ${deepSkyMode ? "끄기" : "켜기"}`}
        >
          <ToolbarIcon name="deepSky" />
        </button>
        <div className={styles.toolbarSettingsWrapper}>
          <button type="button" className={fieldOfViewStage ? styles.active : ""} onClick={onFieldOfViewToggle}
            disabled={!isEngineReady} aria-label="촬영 화각" aria-pressed={fieldOfViewStage > 0}
            title={fieldOfViewStage === 0 ? "화각 표시" : fieldOfViewStage === 1 ? "카메라 시야로 보기" : "화각 닫기·이전 화면"}>
            <ToolbarIcon name="fieldOfView" />
          </button>
          {(fieldOfViewStage > 0 || fieldOfViewMessage) && <div className={styles.fieldOfViewInfo} role="status">
            {fieldOfViewMessage || <><strong>{fieldOfViewLabel}</strong><span>{fieldOfViewStage === 1 ? "한 번 더 누르면 카메라 시야" : "한 번 더 누르면 닫기"}</span></>}
            {fieldOfViewMessage && <button type="button" aria-label="화각 안내 닫기" onClick={onFieldOfViewMessageDismiss}>×</button>}
          </div>}
        </div>
        <div className={styles.toolbarSettingsWrapper}>
          <button type="button" className={eyepieceFieldOfViewStage ? styles.active : ""} onClick={onEyepieceFieldOfViewToggle}
            disabled={!isEngineReady} aria-label="접안렌즈 화각" aria-pressed={eyepieceFieldOfViewStage > 0}
            title={eyepieceFieldOfViewStage === 0 ? "접안렌즈 화각 표시" : eyepieceFieldOfViewStage === 1 ? "접안렌즈 시야로 보기" : "접안렌즈 화각 닫기·이전 화면"}>
            <ToolbarIcon name="eyepieceFieldOfView" />
          </button>
          {(eyepieceFieldOfViewStage > 0 || eyepieceFieldOfViewMessage) && <div className={styles.fieldOfViewInfo} role="status">
            {eyepieceFieldOfViewMessage || <><strong>{eyepieceFieldOfViewLabel}</strong><span>{eyepieceFieldOfViewStage === 1 ? "한 번 더 누르면 접안렌즈 시야" : "한 번 더 누르면 닫기"}</span></>}
            {eyepieceFieldOfViewMessage && <button type="button" aria-label="접안렌즈 화각 안내 닫기" onClick={onFieldOfViewMessageDismiss}>×</button>}
          </div>}
        </div>
        <div className={styles.toolbarSettingsWrapper}>
          <button
            type="button"
            className={[
              styles.settingsToolbarButton,
              isDifficultyInfoOpen ? styles.active : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setIsDifficultyInfoOpen((current) => !current)}
            aria-label="관측 난이도 설명"
            aria-expanded={isDifficultyInfoOpen}
            title="관측 난이도 설명"
          >
            <ToolbarIcon name="difficultyInfo" />
          </button>
          {isDifficultyInfoOpen && (
            <section
              className={styles.toolbarDifficultyPanel}
              aria-label="관측 난이도 설명"
            >
              <h2>난이도 설명</h2>
              <ol>
                <li>
                  <strong>1단계</strong>
                  <span>안시 관측 가능</span>
                </li>
                <li>
                  <strong>2단계</strong>
                  <span>망원경 안시 관측 가능</span>
                </li>
                <li>
                  <strong>3단계</strong>
                  <span>망원경 촬영 가능</span>
                </li>
                <li>
                  <strong>4단계</strong>
                  <span>필터 등 특수 장비 필요</span>
                </li>
                <li>
                  <strong>5단계</strong>
                  <span>현재 조건에서 관측 불가</span>
                </li>
              </ol>
            </section>
          )}
        </div>
        <div className={styles.toolbarSettingsWrapper}>
          <button
            type="button"
            className={[
              styles.settingsToolbarButton,
              isSettingsOpen ? styles.active : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              closeLineMenu();
              setIsDifficultyInfoOpen(false);
              setIsSettingsOpen(true);
            }}
            aria-label="설정"
            aria-haspopup="dialog"
            aria-expanded={isSettingsOpen}
            aria-controls={isSettingsOpen ? settingsWindowId : undefined}
            title="설정"
          >
            <ToolbarIcon name="settings" />
          </button>
        </div>
      </div>
      {isSettingsOpen && (
        <SettingsWindow
          id={settingsWindowId}
          backgrounds={backgrounds}
          onShowGround={onShowGround}
          telescopeSettings={telescopeSettings}
          cameraSettings={cameraSettings}
          eyepieceSettings={eyepieceSettings}
          onEyepieceSettingsChange={onEyepieceSettingsChange}
          selectedFilter={selectedFilter}
          onCameraSettingsChange={onCameraSettingsChange}
          onFilterChange={onFilterChange}
          onEquipmentApply={onEquipmentApply}
          onTelescopeSettingsChange={onTelescopeSettingsChange}
          onTelescopeSettingsSave={onTelescopeSettingsSave}
          onClose={closeSettingsWindow}
        />
      )}
    </>
  );
}
