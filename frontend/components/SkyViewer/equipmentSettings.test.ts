import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readActiveEquipment, readEquipmentPresets, saveActiveEquipment, saveEquipmentPresets } from "./equipmentSettings";
const telescope = { focalLengthMm: 1000, apertureMm: 100 };
const camera = { sensorWidthMm: 36, sensorHeightMm: 24, pixelSizeUm: 3.76 };
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
});
afterEach(() => vi.unstubAllGlobals());
it("preserves legacy camera/filter settings when first adopting equipment combinations", () => {
  storage.set("jmgj:camera-settings", JSON.stringify(camera));
  storage.set("jmgj:filter-settings", '"Ha"');
  expect(readActiveEquipment(telescope)).toEqual({ telescope, camera, filter: "Ha" });
});
it("persists and reloads the complete combination together", () => {
  const equipment = { telescope, camera, filter: "OIII" as const };
  saveActiveEquipment(equipment);
  saveEquipmentPresets([{ ...equipment, id: "test", name: "주 촬영 장비" }]);
  expect(readActiveEquipment({ focalLengthMm: 500, apertureMm: 80 })).toEqual(equipment);
  expect(readEquipmentPresets()[0]).toEqual({ ...equipment, id: "test", name: "주 촬영 장비" });
});
it("ignores broken saved data without failing startup", () => {
  storage.set("jmgj:active-equipment-v1", '{"telescope":{}}');
  storage.set("jmgj:equipment-presets-v1", '[{"name":"broken"},null]');
  expect(readActiveEquipment(telescope).telescope).toEqual(telescope);
  expect(readEquipmentPresets()).toEqual([]);
});
it("does not replace the previous active combination when storage fails", () => {
  const equipment = { telescope, camera, filter: null };
  saveActiveEquipment(equipment);
  window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  expect(() => saveActiveEquipment({ ...equipment, telescope: { ...telescope, focalLengthMm: 500 } })).toThrow();
  expect(readActiveEquipment(telescope)).toEqual(equipment);
});

it("saves and restores a visual observing combination with no configured camera", () => {
  const equipment = { telescope, camera: { sensorWidthMm: null, sensorHeightMm: null, pixelSizeUm: null }, eyepiece: { focalLengthMm: 25, apparentFieldDegrees: 60 }, filter: null };
  saveActiveEquipment(equipment);
  saveEquipmentPresets([{ ...equipment, id: "visual", name: "안시 관측" }]);
  expect(readActiveEquipment(telescope)).toEqual(equipment);
  expect(readEquipmentPresets()[0].eyepiece).toEqual(equipment.eyepiece);
});

it("rejects invalid new eyepiece specifications while preserving old combinations", () => {
  const equipment = { telescope, camera, filter: null };
  saveActiveEquipment(equipment);
  expect(() => saveActiveEquipment({ ...equipment, eyepiece: { focalLengthMm: 25, apparentFieldDegrees: 181 } })).toThrow();
  expect(readActiveEquipment(telescope)).toEqual(equipment);
  saveEquipmentPresets([{ ...equipment, id: "old", name: "기존 장비" }]);
  expect(readEquipmentPresets()[0]).toEqual({ ...equipment, id: "old", name: "기존 장비" });
});
