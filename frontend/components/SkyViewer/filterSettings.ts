import type { ObservationFilter } from "./types";

const STORAGE_KEY = "jmgj:filter-settings";

export const FILTER_GROUPS = [
  { name: "RGB", filters: [
    { id: "R", label: "R" },
    { id: "G", label: "G" },
    { id: "B", label: "B" },
  ] },
  { name: "SHO", filters: [
    { id: "SII", label: "SⅡ" },
    { id: "Ha", label: "Hα" },
    { id: "OIII", label: "OⅢ" },
  ] },
] as const;

const FILTER_IDS = new Set<string>(FILTER_GROUPS.flatMap((group) => group.filters.map((filter) => filter.id)));

export function readStoredFilterSetting(): ObservationFilter | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return typeof value === "string" && FILTER_IDS.has(value) ? value as ObservationFilter : null;
  } catch {
    return null;
  }
}

export function saveStoredFilterSetting(filter: ObservationFilter | null): void {
  if (filter !== null && !FILTER_IDS.has(filter)) throw new Error("Invalid filter setting");
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
}
