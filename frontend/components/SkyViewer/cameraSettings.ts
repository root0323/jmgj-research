import type { CameraSettings } from "./types";

const STORAGE_KEY = "jmgj:camera-settings";

const EMPTY_CAMERA_SETTINGS: CameraSettings = {
  sensorWidthMm: null,
  sensorHeightMm: null,
  pixelSizeUm: null,
};

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function readStoredCameraSettings(): CameraSettings {
  if (typeof window === "undefined") return { ...EMPTY_CAMERA_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_CAMERA_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_CAMERA_SETTINGS };
    const values = parsed as Partial<CameraSettings>;
    return {
      sensorWidthMm: positiveNumber(values.sensorWidthMm),
      sensorHeightMm: positiveNumber(values.sensorHeightMm),
      pixelSizeUm: positiveNumber(values.pixelSizeUm),
    };
  } catch {
    return { ...EMPTY_CAMERA_SETTINGS };
  }
}

export function isValidCameraSettings(settings: CameraSettings): boolean {
  return positiveNumber(settings.sensorWidthMm) !== null &&
    positiveNumber(settings.sensorHeightMm) !== null &&
    positiveNumber(settings.pixelSizeUm) !== null;
}

export function saveStoredCameraSettings(settings: CameraSettings): void {
  if (!isValidCameraSettings(settings)) throw new Error("Invalid camera settings");
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
