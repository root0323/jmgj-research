import type { CameraSettings, EyepieceSettings, ObservationFilter, TelescopeSettings } from "./types";
import { readStoredCameraSettings } from "./cameraSettings";
import { FILTER_GROUPS, readStoredFilterSetting } from "./filterSettings";

export type EquipmentSettings = {
  telescope: TelescopeSettings;
  camera: CameraSettings;
  eyepiece?: EyepieceSettings;
  filter: ObservationFilter | null;
};
export type EquipmentPreset = EquipmentSettings & { id: string; name: string };
const ACTIVE_KEY = "jmgj:active-equipment-v1";
const PRESETS_KEY = "jmgj:equipment-presets-v1";
const filters = new Set<string>(FILTER_GROUPS.flatMap(group => group.filters.map(filter => filter.id)));
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
export const EMPTY_EYEPIECE: EyepieceSettings = { focalLengthMm: null, apparentFieldDegrees: null };
export function isValidEyepiece(settings: EyepieceSettings) {
  return positive(settings.focalLengthMm) && positive(settings.apparentFieldDegrees) && settings.apparentFieldDegrees! <= 180;
}

export function isEquipmentSettings(value: unknown): value is EquipmentSettings {
  if (!value || typeof value !== "object") return false;
  const item = value as EquipmentSettings;
  return !!item.telescope && positive(item.telescope.focalLengthMm) && positive(item.telescope.apertureMm) &&
    !!item.camera && [item.camera.sensorWidthMm, item.camera.sensorHeightMm, item.camera.pixelSizeUm]
      .every(number => number === null || positive(number)) &&
    (item.filter === null || (typeof item.filter === "string" && filters.has(item.filter))) &&
    (item.eyepiece === undefined || (!!item.eyepiece &&
      (item.eyepiece.focalLengthMm === null || positive(item.eyepiece.focalLengthMm)) &&
      (item.eyepiece.apparentFieldDegrees === null || (positive(item.eyepiece.apparentFieldDegrees) && item.eyepiece.apparentFieldDegrees <= 180))));
}

export function readActiveEquipment(telescope: TelescopeSettings): EquipmentSettings {
  const fallback = { telescope, camera: readStoredCameraSettings(), filter: readStoredFilterSetting() };
  if (typeof window === "undefined") return fallback;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(ACTIVE_KEY) ?? "null");
    return isEquipmentSettings(value) ? value : fallback;
  } catch { return fallback; }
}

export function saveActiveEquipment(settings: EquipmentSettings) {
  if (!isEquipmentSettings(settings)) throw new Error("Invalid equipment settings");
  // One record makes applying a combination atomic, including storage failures.
  window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(settings));
}

export function readEquipmentPresets(): EquipmentPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PRESETS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is EquipmentPreset => {
      if (!isEquipmentSettings(item)) return false;
      const preset = item as Partial<EquipmentPreset>;
      return typeof preset.id === "string" && !!preset.id && typeof preset.name === "string" &&
        !!preset.name.trim() && preset.name.length <= 60;
    });
  } catch { return []; }
}

export function saveEquipmentPresets(presets: EquipmentPreset[]) {
  window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}
