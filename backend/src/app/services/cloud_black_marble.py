"""Download immutable app tiles from Cloudflare; no NASA login is required.

The catalogue ships with the app, pinning every filename, byte count and SHA-256.
Only verified files become visible to the model. Existing research data are kept.
"""
import json
from pathlib import Path
import re
import shutil
import threading
from urllib.parse import urlparse

import requests

from app.local_config import setting
from app.services.annual_black_marble import NAME, PRODUCT, YEAR, _write_json, cached_annual_tiles, world_root
from app.services.black_marble_storage import file_sha256
from app.services.geospatial_assets import AssetError, light_tiles, validate_light

BASE_URL = "https://astrosky-black-marble.jmgj-kakao-search.workers.dev/VJ146A4-2025"
MAX_TILE_BYTES = 25 * 1024**2
LOCK = threading.RLock()


def read_catalogue(path: Path) -> dict:
    try:
        if path.stat().st_size > 1_000_000:
            raise ValueError()
        data = json.loads(path.read_text(encoding="utf-8"))
        tiles = data["tiles"]
        if (data["product"] != PRODUCT or data["year"] != YEAR or data["version"] != 2
                or not isinstance(tiles, dict) or len(tiles) != 540):
            raise ValueError()
        for tile, item in tiles.items():
            match = NAME.fullmatch(item["file"])
            if (not match or match[1] != tile or not 0 <= int(tile[1:3]) < 36
                    or not 1 <= int(tile[4:6]) <= 15
                    or type(item["compactBytes"]) is not int
                    or not 8 <= item["compactBytes"] <= MAX_TILE_BYTES
                    or not re.fullmatch(r"[a-f0-9]{64}", item["compactSha256"])):
                raise ValueError()
        return data
    except (OSError, ValueError, TypeError, KeyError):
        raise AssetError("앱의 야간광 자료 목록이 올바르지 않습니다. 앱 업데이트를 확인해 주세요.") from None


def _base_url() -> str:
    url = setting("BLACK_MARBLE_ASSETS_URL", BASE_URL).rstrip("/")
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.hostname != urlparse(BASE_URL).hostname
            or parsed.port not in (None, 443) or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path != "/VJ146A4-2025"):
        raise AssetError("야간광 자료 서버 설정이 올바르지 않습니다.")
    return url


def _download(item: dict, destination: Path, progress):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".h5.part")
    try:
        if shutil.disk_usage(destination.parent).free < item["compactBytes"] + 64 * 1024**2:
            raise AssetError("야간광 자료를 저장할 공간이 부족합니다. 기존 자료는 유지됩니다.")
        url = _base_url() + "/compact/" + item["file"]
        with requests.get(url, stream=True, timeout=(15, 90), allow_redirects=False) as response:
            if response.status_code != 200:
                raise AssetError(f"야간광 자료 다운로드 실패 (HTTP {response.status_code}). 다시 시도해 주세요.")
            count = 0
            with temporary.open("wb") as output:
                for chunk in response.iter_content(1024 * 1024):
                    count += len(chunk)
                    if count > item["compactBytes"]:
                        raise AssetError("야간광 자료의 크기가 목록과 다릅니다. 다시 시도해 주세요.")
                    output.write(chunk)
            if count != item["compactBytes"] or file_sha256(temporary) != item["compactSha256"]:
                raise AssetError("야간광 자료 검증에 실패했습니다. 다시 시도해 주세요.")
            validate_light(temporary)
            temporary.replace(destination)
    except requests.RequestException:
        raise AssetError("야간광 자료 서버에 연결하지 못했습니다. 처음 사용하는 지역은 인터넷 연결이 필요합니다.") from None
    except (OSError, ValueError) as error:
        if isinstance(error, AssetError):
            raise
        raise AssetError("야간광 자료를 저장하지 못했습니다. 연결과 저장 공간을 확인해 주세요.") from None
    finally:
        temporary.unlink(missing_ok=True)


def ensure_annual_tiles(bounds, progress=lambda message: None) -> dict | None:
    """Fetch only the missing tiles around the observer, reusing verified caches."""
    with LOCK:
        ready = cached_annual_tiles(bounds)
        if ready:
            return ready
        catalogue_path = setting("BLACK_MARBLE_CATALOG_FILE")
        if not catalogue_path:
            return None  # Older web/research deployments can still use their local data.
        catalogue = read_catalogue(Path(catalogue_path))
        required = light_tiles(bounds)
        if any(tile not in catalogue["tiles"] for tile in required):
            raise AssetError("이 지역은 현재 연별 야간광 자료의 제공 범위를 벗어납니다.")
        root = world_root()
        index_path = root / "index.json"
        if index_path.exists():
            try:
                index = json.loads(index_path.read_text(encoding="utf-8"))
                if index["product"] != PRODUCT or index["year"] != YEAR or not isinstance(index["tiles"], dict):
                    raise ValueError()
            except (OSError, ValueError, KeyError, TypeError):
                raise AssetError("저장된 야간광 목록이 올바르지 않습니다. 데이터 폴더를 확인해 주세요.") from None
        else:
            index = {"product": PRODUCT, "version": 2, "year": YEAR, "tiles": {}}
        for tile in required:
            item = catalogue["tiles"][tile]
            path = root / "compact" / item["file"]
            # Recover a completed download if the process stopped before publishing its index.
            if not (path.is_file() and path.stat().st_size == item["compactBytes"]
                    and file_sha256(path) == item["compactSha256"]):
                progress(f"야간광 자료 저장 중… {required.index(tile) + 1}/{len(required)} · {item['compactBytes']/1e6:.1f}MB")
                _download(item, path, progress)
            index["tiles"][tile] = dict(item)
            _write_json(index_path, index)
        return cached_annual_tiles(bounds)
