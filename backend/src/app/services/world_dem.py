"""Verified, resumable, losslessly packed native Copernicus GLO-90 tiles.

Keep tiles separately; never build a global raster in memory. The public S3
listing freezes object lengths and ETags. No account or token is used.
"""
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import threading
import time
import xml.etree.ElementTree as ET

import numpy as np
import rasterio
import requests

from app.local_config import setting
from app.services.geospatial_assets import AssetError, DEM_BASE, DEM_CREDIT, asset_root, dem_tile, download
from app.services.dem_storage import PACKED, ORIGINAL, file_hash, pack_tile, verify_storage

PRODUCT = "Copernicus-GLO-90"
NAME = re.compile(r"Copernicus_DSM_COG_30_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM")
NS = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
RESERVE = 2 * 1024**3
MOSAIC_LOCK = threading.Lock()


def world_dem_root() -> Path:
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share")))
    return Path(setting("DEM_GLOBAL_DIR", str(local / "jmgj-research/dem/Copernicus-GLO-90"))).expanduser().resolve()


def _coordinates(name):
    match = NAME.fullmatch(name)
    if not match:
        raise AssetError("DEM 타일 이름이 올바르지 않습니다.")
    lat = int(match[2]) * (-1 if match[1] == "S" else 1)
    lon = int(match[4]) * (-1 if match[3] == "W" else 1)
    if not -90 <= lat < 90 or not -180 <= lon < 180 or dem_tile(lat, lon) != name:
        raise AssetError("DEM 타일 좌표가 올바르지 않습니다.")
    return lat, lon


def validate_record(record):
    _coordinates(record["name"])
    if not isinstance(record.get("bytes"), int) or not 8 <= record["bytes"] <= 100_000_000:
        raise AssetError("DEM 파일 크기 정보가 올바르지 않습니다.")
    if not re.fullmatch(r"[0-9a-f]{32}(?:-\d+)?", record.get("etag", "")):
        raise AssetError("DEM 파일 검증 정보가 올바르지 않습니다.")


def discover_world_dem(progress=lambda message: None):
    try:
        response = requests.get(f"{DEM_BASE}/tileList.txt", timeout=45)
        response.raise_for_status()
        names = set(response.text.splitlines())
        if len(names) < 26000:
            raise AssetError("공식 DEM 전체 타일 목록을 받지 못했습니다.")
        for name in names:
            _coordinates(name)

        def page_group(prefix):
            session = requests.Session()
            found, continuation = [], None
            try:
                while True:
                    params = {"list-type": "2", "max-keys": 1000, "prefix": prefix}
                    if continuation:
                        params["continuation-token"] = continuation
                    result = session.get(DEM_BASE + "/", params=params, timeout=45)
                    result.raise_for_status()
                    root = ET.fromstring(result.content)
                    for item in root.findall("s:Contents", NS):
                        key = item.findtext("s:Key", namespaces=NS) or ""
                        name = key.split("/", 1)[0]
                        if name in names and key == f"{name}/{name}.tif":
                            record = {"name": name, "bytes": int(item.findtext("s:Size", namespaces=NS)),
                                      "etag": item.findtext("s:ETag", namespaces=NS).strip('"')}
                            validate_record(record)
                            found.append(record)
                    if root.findtext("s:IsTruncated", namespaces=NS) == "false":
                        return found
                    next_token = root.findtext("s:NextContinuationToken", namespaces=NS)
                    if not next_token or next_token == continuation:
                        raise AssetError("DEM 전체 파일 목록이 중간에 끊겼습니다.")
                    continuation = next_token
            finally:
                session.close()

        prefixes = [f"Copernicus_DSM_COG_30_{hemisphere}{digit}" for hemisphere in "NS" for digit in range(10)]
        records = []
        with ThreadPoolExecutor(max_workers=4) as executor:
            for group in executor.map(page_group, prefixes):
                records.extend(group)
                progress(f"전 세계 DEM 파일 크기 확인: {len(records):,}개")
        if len(records) != len(names) or {r["name"] for r in records} != names:
            raise AssetError("공식 목록과 전 세계 DEM 파일 목록이 일치하지 않습니다.")
        return {"product": PRODUCT, "release": "2021", "source": DEM_BASE, "credit": DEM_CREDIT,
                "frozenAt": datetime.now(timezone.utc).isoformat(),
                "records": sorted(records, key=lambda r: r["name"])}
    except (requests.RequestException, ET.ParseError, KeyError, TypeError, ValueError) as error:
        if isinstance(error, AssetError):
            raise
        raise AssetError("전 세계 DEM 목록 조회 실패. 네트워크와 공개 자료 상태를 확인해 주세요.") from None


def write_manifest(path, manifest):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def verify_tile(path, record):
    """Check server length/ETag, decode the entire native raster, and hash bytes."""
    validate_record(record)
    if path.stat().st_size != record["bytes"]:
        raise AssetError("DEM 파일 크기가 공식 목록과 다릅니다.")
    sha, md5 = hashlib.sha256(), hashlib.md5(usedforsecurity=False)
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            sha.update(chunk)
            md5.update(chunk)
    if "-" not in record["etag"] and md5.hexdigest() != record["etag"]:
        raise AssetError("DEM 파일의 MD5가 공식 S3 ETag와 다릅니다.")
    lat, lon = _coordinates(record["name"])
    with rasterio.open(path) as source:
        if source.crs != rasterio.crs.CRS.from_epsg(4326) or source.count != 1 or source.dtypes != ("float32",):
            raise AssetError("DEM 좌표계·자료형·밴드가 올바르지 않습니다.")
        transform = source.transform
        if (source.height != 1200 or source.width not in (1200, 800, 600, 400, 240, 120)
                or abs(transform.e + 1/1200) > 1e-10 or transform.b or transform.d
                or abs(transform.a * source.width - 1) > 1e-7
                or abs(source.bounds.left - lon) > .01 or abs(source.bounds.top - (lat+1)) > .01):
            raise AssetError("DEM 원본 격자 또는 타일 위치가 올바르지 않습니다.")
        for _, window in source.block_windows(1):
            data = source.read(1, window=window, masked=True)
            if not np.isfinite(data.compressed()).all():
                raise AssetError("DEM 높이 값에 잘못된 값이 있습니다.")
    return sha.hexdigest()


class WorldDEM:
    def __init__(self, root=None, manifest=None, progress=lambda message: None):
        self.root = (root or world_dem_root()).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / "manifest.json"
        if path.exists():
            self.manifest = json.loads(path.read_text(encoding="utf-8"))
        else:
            self.manifest = manifest or discover_world_dem(progress)
            write_manifest(path, self.manifest)
        if self.manifest.get("product") != PRODUCT or self.manifest.get("source") != DEM_BASE:
            raise AssetError("저장된 DEM 목록의 제품·출처가 올바르지 않습니다.")
        self.records = self.manifest.get("records", [])
        if not self.records or len({r["name"] for r in self.records}) != len(self.records):
            raise AssetError("DEM 타일 목록에 중복 또는 누락이 있습니다.")
        for record in self.records:
            validate_record(record)
        self.database = self.root / "index.sqlite"
        with closing(sqlite3.connect(self.database)) as database:
            database.execute("CREATE TABLE IF NOT EXISTS tiles (name TEXT PRIMARY KEY, bytes INTEGER NOT NULL, etag TEXT NOT NULL, sha256 TEXT NOT NULL, verified_at TEXT NOT NULL)")
            database.execute("CREATE TABLE IF NOT EXISTS storage (name TEXT PRIMARY KEY, format TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, source_sha256 TEXT NOT NULL, array_sha256 TEXT NOT NULL, verified_at TEXT NOT NULL)")
            database.commit()

    def status(self):
        with closing(sqlite3.connect(self.database)) as database:
            count, size = database.execute("SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM tiles").fetchone()
            optimized, compressed, saved = database.execute(
                "SELECT COUNT(*),COALESCE(SUM(s.format=?),0),COALESCE(SUM(t.bytes-s.bytes),0) "
                "FROM storage s JOIN tiles t ON t.name=s.name", (PACKED,)).fetchone()
        total = sum(r["bytes"] for r in self.records)
        return {"product": PRODUCT, "total": len(self.records), "completed": count, "sourceBytes": total,
                "completedBytes": size-saved, "completedSourceBytes": size, "remainingSourceBytes": total-size,
                "optimized": optimized, "compressed": compressed, "savedBytes": saved,
                "freeBytes": shutil.disk_usage(self.root).free, "directory": str(self.root)}

    def _process(self, record, database, progress):
        name = record["name"]
        path = self.root / "tiles" / (name + ".tif")
        compact = self.root / "compact" / (name + ".tif")
        saved = database.execute("SELECT bytes,etag,sha256 FROM tiles WHERE name=?", (name,)).fetchone()
        stored = database.execute("SELECT format,bytes,sha256,source_sha256,array_sha256 FROM storage WHERE name=?", (name,)).fetchone()
        if stored:
            progress(f"저장된 압축 DEM 확인: {name}")
            if not saved or saved != (record["bytes"], record["etag"], stored[3]):
                raise AssetError("DEM 압축본과 원본 색인이 다릅니다.")
            verify_storage(compact if stored[0] == PACKED else path, record, stored, verify_tile)
            # A crash after the database commit can leave this owned duplicate.
            if stored[0] == PACKED and path.exists():
                if verify_tile(path, record) != stored[3]:
                    raise AssetError("DEM 원본 해시가 다릅니다. 중복 원본을 유지합니다.")
                path.unlink()
            return
        if path.exists():
            progress(f"저장된 DEM 확인: {name}")
            sha = verify_tile(path, record)
            if saved and (saved[0] != record["bytes"] or saved[1] != record["etag"] or saved[2] != sha):
                raise AssetError("기존 DEM 검증 정보가 달라 중단했습니다. 원본 파일을 유지합니다.")
        else:
            database.execute("DELETE FROM tiles WHERE name=?", (name,))
            database.commit()
            if shutil.disk_usage(self.root).free < record["bytes"] + RESERVE:
                raise AssetError("DEM 저장 공간이 부족합니다. 완료 파일은 유지됩니다.")
            path.parent.mkdir(parents=True, exist_ok=True)
            # Validate the staging file before it can become an app-visible tile.
            staging = path.with_suffix(".download.tif")
            progress(f"DEM 다운로드: {name} · {record['bytes']/1e6:.1f}MB")
            try:
                existing = asset_root() / "dem" / path.name
                if existing.is_file():
                    shutil.copyfile(existing, staging)
                else:
                    for attempt in range(3):
                        try:
                            download(f"{DEM_BASE}/{name}/{name}.tif", staging, max_bytes=record["bytes"]+1)
                            break
                        except AssetError as error:
                            transient = "자료 서버에 연결하지 못" in str(error) or re.search(r"HTTP (429|500|502|503|504)", str(error))
                            if not transient or attempt == 2:
                                raise
                            progress(f"DEM 연결 재시도: {name}")
                            time.sleep(2 ** (attempt+1))
                sha = verify_tile(staging, record)
                staging.rename(path)
            finally:
                staging.unlink(missing_ok=True)
        progress(f"DEM 무손실 압축·전체 값 비교: {name}")
        candidate = compact.with_suffix(".compact.tmp.tif")
        try:
            format_name, stored_bytes, stored_sha, digest = pack_tile(path, candidate, record, sha)
            if file_hash(path) != sha:
                raise AssetError("DEM 변환 중 원본 해시가 달라 중단했습니다. 원본을 유지합니다.")
            if format_name == PACKED:
                candidate.replace(compact)
            timestamp = datetime.now(timezone.utc).isoformat()
            # Readers switch to the verified compact file at the commit. The
            # source is removed only afterward, never before full comparison.
            with database:
                database.execute("INSERT OR REPLACE INTO tiles VALUES (?,?,?,?,?)",
                                 (name, record["bytes"], record["etag"], sha, timestamp))
                database.execute("INSERT OR REPLACE INTO storage VALUES (?,?,?,?,?,?,?)",
                                 (name, format_name, stored_bytes, stored_sha, sha, digest, timestamp))
            if format_name == PACKED:
                path.unlink()
        finally:
            candidate.unlink(missing_ok=True)

    def run(self, stopped, progress=lambda message: None):
        state = self.status()
        # Leave enough room for the concurrently running Black Marble download.
        other = 0
        from app.services.annual_black_marble import world_root
        manifest = world_root() / "manifest.json"
        if manifest.is_file():
            other = sum(r["bytes"] for r in json.loads(manifest.read_text(encoding="utf-8"))["records"])
        if state["freeBytes"] < state["remainingSourceBytes"] + other + RESERVE:
            raise AssetError("전 세계 DEM과 Black Marble을 함께 저장할 여유 공간이 부족합니다.")
        def process(record):
            if stopped.is_set():
                return
            with closing(sqlite3.connect(self.database, timeout=30)) as database:
                self._process(record, database, progress)

        # Convert already downloaded originals first, then receive new tiles.
        with closing(sqlite3.connect(self.database)) as database:
            ready = {row[0] for row in database.execute("SELECT name FROM tiles")}
        records = iter(sorted(self.records, key=lambda record: record["name"] not in ready))
        with ThreadPoolExecutor(max_workers=4) as executor:
            pending = {executor.submit(process, record) for record in [next(records, None) for _ in range(8)] if record}
            try:
                while pending:
                    completed, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for future in completed:
                        future.result()
                        if not stopped.is_set():
                            record = next(records, None)
                            if record:
                                pending.add(executor.submit(process, record))
            except Exception:
                stopped.set()
                for future in pending:
                    future.cancel()
                raise
        if stopped.is_set():
            progress("중단했습니다. 다음 시작 시 완료된 DEM을 재사용합니다.")
            return False
        return True


def global_dem_names():
    path = world_dem_root() / "manifest.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("product") == PRODUCT and data.get("source") == DEM_BASE:
            return {r["name"] for r in data["records"]}
    except (OSError, KeyError, TypeError, ValueError):
        pass
    return None


def cached_dem_tile(name):
    _coordinates(name)
    root = world_dem_root()
    path = root / "tiles" / (name + ".tif")
    try:
        with closing(sqlite3.connect((root / "index.sqlite").as_uri() + "?mode=ro", uri=True)) as database:
            row = database.execute("SELECT bytes,sha256 FROM tiles WHERE name=?", (name,)).fetchone()
            try:
                stored = database.execute("SELECT format,bytes,source_sha256 FROM storage WHERE name=?", (name,)).fetchone()
            except sqlite3.OperationalError:  # Previous native-copy index.
                stored = None
        if row and stored:
            if stored[2] != row[1] or stored[0] not in (PACKED, ORIGINAL):
                return None
            if stored[0] == PACKED:
                path = root / "compact" / (name + ".tif")
            return path if path.stat().st_size == stored[1] else None
        return path if row and path.stat().st_size == row[0] else None
    except (OSError, sqlite3.Error):
        return None


def cached_world_dem(bounds):
    """Build a small local mosaic only when all required land tiles are ready."""
    known = global_dem_names()
    if known is None:
        return None
    west, south, east, north = bounds
    for lat in range(math.floor(south), math.ceil(north)):
        for lon in range(math.floor(west), math.ceil(east)):
            name = dem_tile(lat, lon)
            if name in known and cached_dem_tile(name) is None:
                return None
    from app.services.geospatial_assets import prepare_dem
    try:
        with MOSAIC_LOCK:
            return prepare_dem(bounds, world_dem_root() / "regions", allow_download=False)
    except (OSError, ValueError):
        return None
