import { useState } from "react";
import { readEquipmentPresets, saveEquipmentPresets } from "./equipmentSettings";
import type { EquipmentSettings } from "./equipmentSettings";
import { isValidCameraSettings } from "./cameraSettings";
import styles from "./SettingsWindow.module.css";

export function EquipmentPresetsPanel({ equipment, onApply }: {
  equipment: EquipmentSettings;
  onApply: (equipment: EquipmentSettings) => void;
}) {
  const [presets, setPresets] = useState(readEquipmentPresets);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  function run(action: () => void, success: string) {
    try { action(); setMessage(success); setError(false); }
    catch { setMessage("저장하지 못했습니다. 앱의 저장 공간을 확인해 주세요."); setError(true); }
  }
  return (
    <section className={styles.presets} aria-label="장비 조합">
      <h4>장비 조합</h4>
      <p>현재 망원경·카메라·필터 설정을 함께 저장합니다.</p>
      <form onSubmit={event => {
        event.preventDefault();
        if (!name.trim() || !isValidCameraSettings(equipment.camera)) return;
        run(() => {
          const next = [...presets, { ...equipment, id: crypto.randomUUID(), name: name.trim() }];
          saveEquipmentPresets(next); setPresets(next); setName("");
        }, "장비 조합을 저장했습니다.");
      }}>
        <label>조합 이름<input value={name} maxLength={60} placeholder="예: 주 촬영 장비" onChange={event => setName(event.target.value)} /></label>
        <button className={styles.saveButton} disabled={!name.trim() || !isValidCameraSettings(equipment.camera)}>조합 저장</button>
      </form>
      {!isValidCameraSettings(equipment.camera) && <p>카메라의 센서 크기와 픽셀 크기를 먼저 입력해 주세요.</p>}
      <ul>
        {presets.map(preset => <li key={preset.id}>
          <div><strong>{preset.name}</strong><small>{preset.telescope.focalLengthMm} / {preset.telescope.apertureMm}mm · {preset.camera.sensorWidthMm} × {preset.camera.sensorHeightMm}mm · {preset.camera.pixelSizeUm}μm · {preset.filter ?? "필터 없음"}</small></div>
          <button type="button" className={styles.saveButton} onClick={() => run(() => onApply(preset), `${preset.name} 적용됨`)}>적용</button>
          <button type="button" className={styles.clearButton} aria-label={`${preset.name} 삭제`} onClick={() => run(() => {
            const next = presets.filter(item => item.id !== preset.id);
            saveEquipmentPresets(next); setPresets(next);
          }, "조합을 삭제했습니다.")}>삭제</button>
        </li>)}
      </ul>
      {message && <p className={error ? styles.saveError : undefined} role="status">{message}</p>}
    </section>
  );
}
