import { useState } from "react";
import type { FormEvent } from "react";
import type { CameraSettings } from "./types";
import {
  isValidCameraSettings,
} from "./cameraSettings";
import styles from "./SettingsWindow.module.css";

const CAMERA_FIELDS: { key: keyof CameraSettings; label: string }[] = [
  { key: "sensorWidthMm", label: "센서 가로(mm)" },
  { key: "sensorHeightMm", label: "센서 세로(mm)" },
  { key: "pixelSizeUm", label: "픽셀 크기(μm)" },
];

export function CameraSettingsPanel({ settings, onChange, onSave }: {
  settings: CameraSettings; onChange: (settings: CameraSettings) => void; onSave: () => void;
}) {
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");

  function updateSetting(key: keyof CameraSettings, value: string) {
    const parsed = value === "" ? null : Number(value);
    onChange({
      ...settings,
      [key]: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    });
    setSaveState("idle");
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidCameraSettings(settings)) return;
    try {
      onSave();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <form className={styles.cameraSettings} onSubmit={handleSave}>
      <div className={styles.fields}>
        {CAMERA_FIELDS.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <input
              name={key}
              type="number"
              min={0.001}
              step="any"
              required
              value={settings[key] ?? ""}
              onChange={(event) => updateSetting(key, event.target.value)}
            />
          </label>
        ))}
      </div>
      <button type="submit" className={styles.saveButton} disabled={!isValidCameraSettings(settings)}>
        {saveState === "saved" ? "저장됨" : "설정 저장"}
      </button>
      {saveState === "error" && (
        <p className={styles.saveError} role="alert">
          설정을 저장하지 못했습니다. 앱의 저장 공간을 확인하고 다시 시도해 주세요.
        </p>
      )}
    </form>
  );
}
