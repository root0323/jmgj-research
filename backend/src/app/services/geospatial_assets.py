"""Explicit, location-scoped downloads of official terrain and night-light data.

No download is triggered by a sky-direction change. NASA credentials are supplied
only to prepare_region and are never persisted in the manifest.
"""
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import urlparse, urljoin

import requests

from app.local_config import setting

DEFAULT_ROOT = Path(__file__).resolve().parents[4] / ".local-data"
NASA_HOSTS = {"data.laadsdaac.earthdatacloud.nasa.gov", "ladsweb.modaps.eosdis.nasa.gov"}
# Observed in the authenticated LAADS HTTPS redirect on 2026-10-07.
# This CDN receives only its signed URL, never the Earthdata bearer token.
NASA_CDN_HOSTS = {"d13j1jds5ybppo.cloudfront.net"}
CMR = "https://cmr.earthdata.nasa.gov/search"
DEM_BASE = "https://copernicus-dem-90m.s3.amazonaws.com"
FIELD = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields/"
DEM_CREDIT = "produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"


class AssetError(ValueError):
    """Safe, deliberately authored error text for the local setup UI."""


def asset_root() -> Path:
    return Path(setting("RESEARCH_ASSET_DIR", str(DEFAULT_ROOT))).expanduser().resolve()


def region_bounds(latitude: float, longitude: float, radius_km: float = 30) -> tuple[float, float, float, float]:
    if not all(math.isfinite(x) for x in (latitude, longitude, radius_km)) or not -85 < latitude < 85 or not -180 < longitude < 180 or not 1 <= radius_km <= 100:
        raise AssetError("지원 범위: 위도 -85~85°, 반경 1~100km입니다.")
    # Extra margin covers raster pixel centers and the model's terrain rays.
    dy = (radius_km + 2) / 110.5
    dx = dy / math.cos(math.radians(min(89, abs(latitude) + dy)))
    bounds = (longitude - dx, latitude - dy, longitude + dx, latitude + dy)
    if bounds[0] <= -180 or bounds[2] >= 180 or bounds[1] <= -90 or bounds[3] >= 90:
        raise AssetError("날짜 변경선·극지방을 가로지르는 영역은 아직 지원하지 않습니다.")
    if (math.ceil(bounds[2]) - math.floor(bounds[0])) * (math.ceil(bounds[3]) - math.floor(bounds[1])) > 36:
        raise AssetError("이 위도에서는 더 작은 반경을 선택해 주세요.")
    return bounds


def dem_tile(latitude: int, longitude: int) -> str:
    return f"Copernicus_DSM_COG_30_{'N' if latitude >= 0 else 'S'}{abs(latitude):02d}_00_{'E' if longitude >= 0 else 'W'}{abs(longitude):03d}_00_DEM"


def light_tiles(bounds):
    west, south, east, north = bounds
    return [f"h{h:02d}v{v:02d}" for h in range(math.floor((west + 180) / 10), math.floor((east + 180) / 10) + 1)
            for v in range(math.floor((90 - north) / 10), math.floor((90 - south) / 10) + 1)]


def download(url: str, destination: Path, token: str = "", max_bytes: int = 300_000_000) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    try:
        for _ in range(6):
            parsed = urlparse(url)
            host = parsed.hostname or ""
            if parsed.scheme != "https" or not (host in NASA_HOSTS | NASA_CDN_HOSTS or host == "copernicus-dem-90m.s3.amazonaws.com" or host.endswith(".amazonaws.com")):
                # Show only a normal server name: signed paths, queries and
                # credentials must never reach the screen or diagnostics.
                server = host if re.fullmatch(r"(?:[a-z0-9-]{1,63}\.)+[a-z]{2,24}", host) and len(host) <= 253 else "확인 불가"
                protocol = "HTTPS" if parsed.scheme == "https" else "HTTPS 아님"
                raise AssetError(f"지원하지 않는 자료 연결 주소로 중단했습니다. 서버: {server} · {protocol}. 기존 파일은 유지됩니다.")
            headers = {"Authorization": f"Bearer {token}"} if token and host in NASA_HOSTS else {}
            with requests.get(url, headers=headers, stream=True, timeout=(15, 90), allow_redirects=False) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers.get("Location", ""))
                    if urlparse(url).hostname == "urs.earthdata.nasa.gov":
                        raise AssetError("NASA 인증이 필요합니다. Earthdata 다운로드 토큰과 계정 권한을 확인해 주세요.")
                    continue
                if response.status_code in (401, 403):
                    raise AssetError("NASA 다운로드 인증에 실패했습니다. Earthdata 다운로드 토큰과 계정 권한을 확인해 주세요.")
                if response.status_code != 200:
                    raise AssetError(f"공식 자료 다운로드 실패 (HTTP {response.status_code}). 잠시 후 다시 시도해 주세요.")
                count = 0
                with temporary.open("wb") as output:
                    for chunk in response.iter_content(1024 * 1024):
                        count += len(chunk)
                        if count > max_bytes:
                            raise AssetError("자료 파일이 다운로드 크기 제한을 초과했습니다.")
                        output.write(chunk)
                if count < 8:
                    raise AssetError("빈 자료 파일입니다.")
                temporary.replace(destination)
                return
        raise AssetError("자료 서버의 리다이렉트가 너무 많습니다.")
    except requests.RequestException:
        raise AssetError("자료 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.") from None
    finally:
        temporary.unlink(missing_ok=True)


def prepare_dem(bounds, root: Path, progress=lambda message: None, *, allow_download: bool = True) -> Path:
    import numpy as np
    import rasterio
    from rasterio.merge import merge
    from rasterio.io import MemoryFile
    from rasterio.transform import from_origin
    from app.services.world_dem import global_dem_names, cached_dem_tile
    root.mkdir(parents=True, exist_ok=True)
    manifest = root / "tileList.txt"
    known = global_dem_names()
    if known is None:
        if not manifest.exists():
            if not allow_download:
                raise AssetError("로컬에 DEM 전체 목록이 없습니다.")
            download(f"{DEM_BASE}/tileList.txt", manifest, max_bytes=5_000_000)
        known = set(manifest.read_text().splitlines())
    west, south, east, north = bounds
    identity = hashlib.sha256(json.dumps(bounds).encode()).hexdigest()[:16]
    output_path = root / f"terrain-{identity}.tif"
    if output_path.exists():
        return output_path
    with ExitStack() as stack:
        sources = []
        for lat in range(math.floor(south), math.ceil(north)):
            for lon in range(math.floor(west), math.ceil(east)):
                tile = dem_tile(lat, lon)
                if tile in known:
                    path = cached_dem_tile(tile) or root / f"{tile}.tif"
                    if not path.exists():
                        if not allow_download:
                            raise AssetError("필요한 DEM 타일이 아직 저장되지 않았습니다.")
                        progress(f"지형 자료 다운로드: {lat}°, {lon}°")
                        download(f"{DEM_BASE}/{tile}/{tile}.tif", path)
                    src = stack.enter_context(rasterio.open(path))
                    if src.crs != rasterio.crs.CRS.from_epsg(4326) or src.count != 1:
                        raise AssetError("지형 자료의 좌표계 또는 밴드가 올바르지 않습니다.")
                    sources.append(src)
                else:
                    # Only official manifest absence is ocean; HTTP failures never become sea level.
                    mem = stack.enter_context(MemoryFile())
                    src = stack.enter_context(mem.open(driver="GTiff", height=1200, width=1200, count=1, dtype="float32", crs="EPSG:4326", transform=from_origin(lon, lat + 1, 1 / 1200, 1 / 1200)))
                    src.write(np.zeros((1, 1200, 1200), dtype="float32"))
                    sources.append(src)
        terrain, transform = merge(sources, bounds=bounds, res=1 / 1200, nodata=-9999)
        if not np.isfinite(terrain).all() or np.any(terrain < -500):
            raise AssetError("지형 자료에 미확인 영역이 있어 계산에 사용할 수 없습니다.")
        temporary = output_path.with_suffix(".part.tif")
        with rasterio.open(temporary, "w", driver="GTiff", count=1, height=terrain.shape[1], width=terrain.shape[2], dtype="float32", crs="EPSG:4326", transform=transform, compress="deflate", nodata=-9999) as dst:
            dst.write(terrain)
            dst.update_tags(credit=DEM_CREDIT, source=DEM_BASE, dataset="Copernicus GLO-90 DSM")
        temporary.replace(output_path)
    return output_path


def discover_light(tile: str, month: str | None = None) -> dict:
    params = {"short_name": "VNP46A3", "version": "2", "page_size": 1, "sort_key": "-start_date",
              "producer_granule_id": f"VNP46A3.A*.{tile}.002.*.h5", "options[producer_granule_id][pattern]": "true"}
    if month:
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise AssetError("자료 기준 월은 YYYY-MM 형식이어야 합니다.")
        import calendar
        year, number = map(int, month.split("-"))
        last = calendar.monthrange(year, number)[1]
        params["temporal"] = f"{month}-01T00:00:00Z,{month}-{last}T23:59:59Z"
    response = requests.get(f"{CMR}/granules.json", params=params, timeout=30)
    response.raise_for_status()
    entries = response.json().get("feed", {}).get("entry", [])
    if not entries:
        raise AssetError(f"NASA에 해당 영역·월의 Black Marble 자료가 없습니다 ({tile}).")
    entry = entries[0]
    for link in entry.get("links", []):
        url = link.get("href", "")
        if urlparse(url).hostname in NASA_HOSTS and urlparse(url).path.endswith(".h5"):
            return {"url": url, "name": Path(urlparse(url).path).name, "month": entry["time_start"][:7], "tile": tile}
    raise AssetError("NASA 메타데이터에 지원되는 다운로드 주소가 없습니다.")


def validate_light(path: Path) -> None:
    import h5py
    with h5py.File(path, "r") as data:
        if any(FIELD + name not in data for name in ("lat", "lon", "AllAngle_Composite_Snow_Free", "AllAngle_Composite_Snow_Free_Quality")):
            raise AssetError("Black Marble 파일에 필요한 좌표·복사휘도·품질 자료가 없습니다.")


def prepare_region(latitude: float, longitude: float, token: str = "", month: str | None = None, terrain_only: bool = False, progress=lambda message: None) -> dict:
    bounds = region_bounds(latitude, longitude)
    root = asset_root()
    dem = prepare_dem(bounds, root / "dem", progress)
    result = {"bounds": bounds, "radiusKm": 30, "dem": str(dem), "blackMarble": [], "month": None,
              "preparedAt": datetime.now(timezone.utc).isoformat()}
    if not terrain_only:
        for tile in light_tiles(bounds):
            asset = discover_light(tile, result["month"] or month)
            result["month"] = asset["month"]
            path = root / "black-marble" / asset["name"]
            if not path.exists():
                if not token:
                    raise AssetError("Black Marble 다운로드에는 NASA Earthdata 다운로드 토큰이 필요합니다. 지형 자료는 저장되었습니다.")
                progress(f"Black Marble 다운로드: {tile} · {asset['month']}")
                download(asset["url"], path, token)
            try:
                validate_light(path)
            except (OSError, ValueError):
                path.unlink(missing_ok=True)
                raise AssetError("Black Marble 파일 검증 실패. NASA 토큰과 다운로드 권한을 확인해 주세요.") from None
            result["blackMarble"].append(str(path))
    identity = hashlib.sha256(json.dumps(bounds).encode()).hexdigest()[:16]
    index = root / "regions"
    index.mkdir(parents=True, exist_ok=True)
    destination = index / f"{identity}.json"
    # A terrain-only refresh must not discard an existing completed region.
    if terrain_only and destination.exists():
        return json.loads(destination.read_text(encoding="utf-8"))
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(destination)
    return result


def cached_region(latitude: float, longitude: float, radius_km: float = 30) -> dict | None:
    wanted = region_bounds(latitude, longitude, max(1, radius_km - 1))
    from app.services.annual_black_marble import cached_annual_tiles
    annual = cached_annual_tiles(region_bounds(latitude, longitude, radius_km))
    for path in sorted((asset_root() / "regions").glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            region = json.loads(path.read_text(encoding="utf-8"))
            west, south, east, north = region["bounds"]
            if west <= wanted[0] and south <= wanted[1] and east >= wanted[2] and north >= wanted[3] and Path(region["dem"]).is_file():
                if annual:
                    return {**region, **annual}
                if region["blackMarble"] and all(Path(p).is_file() for p in region["blackMarble"]):
                    return region
        except (OSError, ValueError, KeyError, TypeError):
            continue
    if annual:
        from app.services.world_dem import cached_world_dem
        bounds = region_bounds(latitude, longitude, radius_km)
        dem = cached_world_dem(bounds)
        if dem:
            return {"bounds": bounds, "dem": str(dem), "radiusKm": radius_km, **annual}
    return None


def cached_status() -> dict:
    from app.services.annual_black_marble import cached_annual_tiles
    regions = []
    for path in (asset_root() / "regions").glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            annual = cached_annual_tiles(data["bounds"])
            regions.append({"bounds": data["bounds"], "month": None if annual else data["month"],
                            "year": annual["year"] if annual else None, "dem": Path(data["dem"]).is_file(),
                            "blackMarble": bool(annual) or (bool(data["blackMarble"]) and all(Path(p).is_file() for p in data["blackMarble"]))})
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return {"regions": regions}
