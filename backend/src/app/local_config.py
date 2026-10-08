"""Operator settings; secrets never go in browser responses or the repository."""
import os
from pathlib import Path

ENV_PATH = Path(os.environ.get("JMGJ_SETTINGS_FILE", str(Path(__file__).with_name(".env"))))


def file_settings() -> dict[str, str]:
    if not ENV_PATH.is_file():
        return {}
    result = {}
    for line in ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            result[name.strip()] = value.strip().strip('\"').strip("'")
    return result


def setting(name: str, default: str = "") -> str:
    # Deployment environment wins; file edits are picked up without a restart.
    return os.environ.get(name, file_settings().get(name, default))


def save_settings(values: dict[str, str]) -> None:
    current = file_settings()
    for name, value in values.items():
        if any(char in value for char in "\r\n\x00"):
            raise ValueError("설정 값에는 줄바꿈을 넣을 수 없습니다.")
        current[name] = value.strip()
    temporary = ENV_PATH.with_suffix(".env.tmp")
    temporary.write_text("# Local operator settings. Never commit this file.\n" +
                         "".join(f"{name}={value}\n" for name, value in sorted(current.items())), encoding="utf-8")
    temporary.replace(ENV_PATH)
