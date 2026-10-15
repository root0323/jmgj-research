import { useState } from "react";
import type { FormEvent } from "react";
import { FILTER_GROUPS } from "./filterSettings";
import type { ObservationFilter } from "./types";
import styles from "./SettingsWindow.module.css";

export function FilterSettingsPanel({ selectedFilter, onChange, onSave }: {
  selectedFilter: ObservationFilter | null; onChange: (filter: ObservationFilter | null) => void; onSave: () => void;
}) {
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      onSave();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <form className={styles.filterSettings} onSubmit={handleSave}>
      {FILTER_GROUPS.map((group) => (
        <fieldset key={group.name} className={styles.filterGroup}>
          <legend>{group.name}</legend>
          <div className={styles.filterOptions}>
            {group.filters.map((filter) => (
              <label key={filter.id} className={styles.filterOption}>
                <input
                  type="radio"
                  name="observation-filter"
                  value={filter.id}
                  checked={selectedFilter === filter.id}
                  onChange={() => {
                    onChange(filter.id);
                    setSaveState("idle");
                  }}
                />
                <span>{filter.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className={styles.filterActions}>
        <button type="submit" className={styles.saveButton}>
          {saveState === "saved" ? "저장됨" : "설정 저장"}
        </button>
        <button
          type="button"
          className={styles.clearButton}
          disabled={selectedFilter === null}
          onClick={() => {
            onChange(null);
            setSaveState("idle");
          }}
        >
          선택 해제
        </button>
      </div>
      {saveState === "error" && (
        <p className={styles.saveError} role="alert">
          설정을 저장하지 못했습니다. 앱의 저장 공간을 확인하고 다시 시도해 주세요.
        </p>
      )}
    </form>
  );
}
