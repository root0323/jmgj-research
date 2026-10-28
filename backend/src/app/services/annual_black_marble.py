"""Resumable, sequential downloads of one frozen annual Black Marble release.

NASA tokens are arguments only. Manifests, reports and progress never contain
credentials. Raw NASA files are retained alongside verified app subsets.
"""
from datetime import datetime, timezone
from functools import lru_cache
import json
import os
from pathlib import Path
import re
import shutil
from urllib.parse import urlparse

import h5py
import numpy as np
import requests

from app.local_config import setting
from app.services.black_marble_storage import (
    FORMAT, compact_black_marble, file_sha256, verify_compact,
)
from app.services.geospatial_assets import AssetError, CMR, NASA_HOSTS, download, light_tiles, validate_light

YEAR = 2025
PRODUCT = "VJ146A4"
NAME = re.compile(r"VJ146A4\.A2025001\.(h\d{2}v\d{2})\.002\.\d{13}\.h5")
RESERVE_BYTES = 2 * 1024**3


def world_root() -> Path:
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share")))
    default = local / "jmgj-research" / "black-marble" / "VJ146A4-2025"
    return Path(setting("BLACK_MARBLE_GLOBAL_DIR", str(default))).expanduser().resolve()


def _write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _check_record(record):
    match = NAME.fullmatch(record.get("name", ""))
    if not match or record.get("tile") != match[1]:
        raise AssetError("연별 자료 목록의 파일명이 올바르지 않습니다.")
    if not (0 <= int(match[1][1:3]) < 36 and 0 <= int(match[1][4:6]) < 18):
        raise AssetError("연별 자료 목록의 타일 번호가 올바르지 않습니다.")
    url = urlparse(record.get("url", ""))
    if url.scheme != "https" or url.hostname not in NASA_HOSTS or url.username or url.password or url.query or url.fragment or Path(url.path).name != record["name"]:
        raise AssetError("공식 NASA 자료 주소만 다운로드할 수 있습니다.")
    if not isinstance(record.get("bytes"), int) or not 8 <= record["bytes"] <= 512 * 1024**2:
        raise AssetError("연별 자료 목록의 파일 크기가 올바르지 않습니다.")


def discover_world() -> dict:
    # Filename matching avoids the Jan-1 temporal overlap with the preceding year.
    params = {"short_name": PRODUCT, "version": "2", "page_size": 2000,
              "producer_granule_id": "VJ146A4.A2025001.*.002.*.h5",
              "options[producer_granule_id][pattern]": "true"}
    try:
        response = requests.get(f"{CMR}/granules.json", params=params, timeout=45)
        response.raise_for_status()
        entries = response.json()["feed"]["entry"]
        if int(response.headers.get("CMR-Hits", len(entries))) != len(entries):
            raise AssetError("NASA 전체 파일 목록을 받지 못했습니다.")
        records = []
        for entry in entries:
            name = entry.get("producer_granule_id", entry.get("title", ""))
            match = NAME.fullmatch(name)
            if not match:
                raise AssetError("다른 연도·제품의 파일이 목록에 섞여 있습니다.")
            links = [item.get("href", "") for item in entry.get("links", [])]
            url = next((link for link in links if urlparse(link).scheme == "https" and urlparse(link).hostname in NASA_HOSTS and Path(urlparse(link).path).name == name), "")
            record = {"name": name, "tile": match[1], "url": url,
                      "bytes": round(float(entry["granule_size"]) * 1024**2)}
            _check_record(record)
            records.append(record)
        if len(records) != 540 or len({record["tile"] for record in records}) != 540:
            raise AssetError("2025년 전체 540개 타일이 확인되지 않아 다운로드를 시작하지 않습니다.")
        return {"product": PRODUCT, "version": 2, "year": YEAR,
                "frozenAt": datetime.now(timezone.utc).isoformat(),
                "records": sorted(records, key=lambda item: item["tile"])}
    except (requests.RequestException, KeyError, TypeError, ValueError) as error:
        if isinstance(error, AssetError):
            raise
        raise AssetError("NASA 연별 자료 목록 조회 실패. 네트워크와 자료 공개 상태를 확인해 주세요.") from None


def _validate_raw(path: Path, record):
    if path.stat().st_size != record["bytes"]:
        raise AssetError("원본 파일 크기가 목록과 다릅니다. 기존 파일을 보존하고 중단했습니다.")
    validate_light(path)
    with h5py.File(path, "r") as handle:
        def text(name):
            value = np.asarray(handle.attrs.get(name, "")).reshape(-1)[0]
            return value.decode("utf-8") if isinstance(value, bytes) else str(value)
        if text("ShortName") != PRODUCT or text("VersionID") not in ("002", "2") or not text("RangeBeginningDate").startswith("2025-01-01"):
            raise AssetError("H5 내부 제품·연도가 다운로드 목록과 다릅니다.")
        if (int(text("HorizontalTileNumber")) != int(record["tile"][1:3]) or
                int(text("VerticalTileNumber")) != int(record["tile"][4:6])):
            raise AssetError("H5 내부 타일 번호가 다운로드 목록과 다릅니다.")


class WorldDownload:
    def __init__(self, root: Path | None = None):
        self.root = (root or world_root()).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / "manifest.json"
        if path.exists():
            self.manifest = json.loads(path.read_text(encoding="utf-8"))
        else:
            self.manifest = discover_world()
            _write_json(path, self.manifest)
        records = self.manifest.get("records", [])
        if self.manifest.get("year") != YEAR or self.manifest.get("product") != PRODUCT or len(records) != 540 or len({r.get("tile") for r in records}) != 540:
            raise AssetError("저장된 전체 자료 목록이 올바르지 않습니다.")
        for record in records:
            _check_record(record)
        index_path = self.root / "index.json"
        self.index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {
            "product": PRODUCT, "version": 2, "year": YEAR, "tiles": {},
        }
        if self.index.get("product") != PRODUCT or self.index.get("year") != YEAR or not isinstance(self.index.get("tiles"), dict):
            raise AssetError("저장된 검증 색인이 올바르지 않습니다.")

    def _paths(self, record):
        return (self.root / "raw" / record["name"], self.root / "compact" / record["name"],
                self.root / "reports" / (record["name"] + ".json"))

    def _ready(self, record):
        raw, compact, report = self._paths(record)
        item = self.index["tiles"].get(record["tile"], {})
        try:
            return (item.get("file") == record["name"] and report.is_file() and
                    raw.stat().st_size == record["bytes"] and compact.stat().st_size == item.get("compactBytes"))
        except OSError:
            return False

    def status(self):
        ready = [record for record in self.manifest["records"] if self._ready(record)]
        total_bytes = sum(record["bytes"] for record in self.manifest["records"])
        return {"product": PRODUCT, "year": YEAR, "total": len(self.manifest["records"]),
                "completed": len(ready), "sourceBytes": total_bytes,
                "remainingSourceBytes": total_bytes - sum(record["bytes"] for record in ready),
                "compactBytes": sum(self.index["tiles"][r["tile"]]["compactBytes"] for r in ready),
                "freeBytes": shutil.disk_usage(self.root).free, "directory": str(self.root)}

    def _process(self, record, token: str, progress):
        raw, compact, report_path = self._paths(record)
        if self._ready(record):
            progress(f"저장 파일 확인: {record['tile']}")
            saved = json.loads(report_path.read_text(encoding="utf-8"))
            if file_sha256(raw) != saved.get("sourceSha256") or file_sha256(compact) != saved.get("compactSha256"):
                raise AssetError("기존 파일의 해시가 달라 중단했습니다. 파일은 덮어쓰지 않았습니다.")
            return
        if not raw.exists():
            if not token:
                raise AssetError("NASA Earthdata 다운로드 토큰을 입력해 주세요.")
            if shutil.disk_usage(self.root).free < record["bytes"] + RESERVE_BYTES + 64 * 1024**2:
                raise AssetError("저장 공간이 부족해 중단했습니다. 완료된 파일은 유지됩니다.")
            progress(f"원본 다운로드: {record['tile']} · 약 {record['bytes']/1e6:.0f}MB")
            download(record["url"], raw, token, max_bytes=record["bytes"] + 1)
        _validate_raw(raw, record)
        progress(f"압축·전체 값 검증: {record['tile']}")
        if compact.exists():
            # Recover a crash between publishing the H5 and its JSON report.
            fields = verify_compact(raw, compact)
            report = {"format": FORMAT, "sourceFile": raw.name,
                      "sourceBytes": raw.stat().st_size, "sourceSha256": file_sha256(raw),
                      "compactBytes": compact.stat().st_size, "compactSha256": file_sha256(compact),
                      "resolutionPreserved": True, "allRetainedValuesBitwiseEqual": True,
                      "sourceAttributesPreserved": True, "fields": fields}
        else:
            report = compact_black_marble(raw, compact)
        _write_json(report_path, report)
        self.index["tiles"][record["tile"]] = {
            "file": record["name"], "sourceBytes": report["sourceBytes"],
            "sourceSha256": report["sourceSha256"], "compactBytes": report["compactBytes"],
            "compactSha256": report["compactSha256"], "verifiedAt": datetime.now(timezone.utc).isoformat(),
        }
        _write_json(self.root / "index.json", self.index)

    def seed(self, folder: Path):
        """Import only exact known NASA filenames from the user-supplied folder."""
        for record in self.manifest["records"]:
            source = folder / record["name"]
            if not source.is_file() or self._ready(record):
                continue
            _validate_raw(source, record)
            raw, _, _ = self._paths(record)
            if not raw.exists():
                raw.parent.mkdir(parents=True, exist_ok=True)
                temporary = raw.with_suffix(".h5.part")
                shutil.copyfile(source, temporary)
                temporary.rename(raw)
            self._process(record, "", lambda message: None)

    def run(self, token: str, stopped, progress):
        status = self.status()
        # Budget conservatively for retained originals and uncompressed subsets.
        required = status["remainingSourceBytes"] + (status["total"]-status["completed"]) * 30_000_000 + RESERVE_BYTES
        if status["freeBytes"] < required:
            raise AssetError("전 세계 원본과 압축 자료를 보관할 여유 공간이 부족합니다.")
        for record in self.manifest["records"]:
            if stopped.is_set():
                progress("중단했습니다. 같은 토큰 입력 화면에서 완료된 파일을 재사용해 이어받을 수 있습니다.")
                return False
            self._process(record, token, progress)
            progress(f"검증 완료: {self.status()['completed']}/540 · {record['tile']}")
        return True


def cached_annual_tiles(bounds) -> dict | None:
    """Only expose published, verified subsets for all required observer tiles."""
    roots = [world_root()]
    bundled = setting("BLACK_MARBLE_BUNDLED_DIR")
    if bundled:
        roots.append(Path(bundled))
    for root in roots:
        result = _cached_tiles(root, bounds)
        if result:
            return result
    return None


def _cached_tiles(root: Path, bounds) -> dict | None:
    try:
        index = json.loads((root / "index.json").read_text(encoding="utf-8"))
        if index.get("product") != PRODUCT or index.get("year") != YEAR:
            return None
        paths = []
        for tile in light_tiles(bounds):
            item = index["tiles"][tile]
            match = NAME.fullmatch(item["file"])
            if not match or match[1] != tile:
                return None
            path = root / "compact" / item["file"]
            stat = path.stat()
            if stat.st_size != item["compactBytes"]:
                return None
            if item.get("compactSha256") and not _verified_hash(str(path), stat.st_size,
                    stat.st_mtime_ns, stat.st_ctime_ns, item["compactSha256"]):
                return None
            paths.append(str(path))
        return {"blackMarble": paths, "month": None, "year": YEAR, "product": PRODUCT}
    except (OSError, KeyError, ValueError, TypeError):
        return None


@lru_cache(maxsize=540)
def _verified_hash(path: str, size: int, modified: int, created: int, expected: str) -> bool:
    # Cache by file identity metadata so sky-direction changes do not reread H5s.
    return file_sha256(Path(path)) == expected
