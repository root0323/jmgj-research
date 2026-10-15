"""Android/WASM adapter. Uses the original model, coefficients and raster resolution.

Only Numba's native JIT is replaced by its ordinary Python function; no socket
server or API credential exists inside this worker. Network and durable storage
are managed by Android. A failed preparation never becomes a ready region.
"""
import json
import math
import sys
import types
from pathlib import Path

numba = types.ModuleType("numba")
def njit(*args, **kwargs):
    def decorate(function):
        function.py_func = function
        return function
    return decorate(args[0]) if args and callable(args[0]) else decorate
numba.njit = njit
sys.modules["numba"] = numba

from app.services.geospatial_assets import region_bounds, dem_tile, light_tiles, prepare_dem, dem_mosaic_bounds
from app.api.endpoints import difficulty

ROOT = Path("/regional-data")
ROOT.mkdir(exist_ok=True)
REGIONS = {}
CATALOGUE = json.loads(Path("/research/catalogue.json").read_text())
def region_key(latitude, longitude):
    return f"{latitude:.6f},{longitude:.6f}"

def cached_region(latitude, longitude, radius_km=30):
    return REGIONS.get(region_key(latitude, longitude)) if radius_km == 30 else None
difficulty.cached_region = cached_region

# GDAL's WASM TIFF writer has no Deflate codec. Only the temporary mosaic's
# compression changes; source tiles stay compressed in Android's durable cache.
import rasterio
_raster_open = rasterio.open
def _wasm_raster_open(*args, **kwargs):
    mode = args[1] if len(args) > 1 else kwargs.get('mode', 'r')
    if mode == 'w':
        kwargs.pop('compress', None)
        kwargs.pop('predictor', None)
    return _raster_open(*args, **kwargs)
rasterio.open = _wasm_raster_open

def plan(latitude, longitude):
    bounds = region_bounds(latitude, longitude)
    west, south, east, north = dem_mosaic_bounds(bounds)
    known = set((ROOT / "tileList.txt").read_text().splitlines())
    result = []
    for lat in range(math.floor(south), math.ceil(north)):
        for lon in range(math.floor(west), math.ceil(east)):
            name = dem_tile(lat, lon)
            if name in known:
                result.append({"name": name + ".tif", "url": f"https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif"})
    for tile in light_tiles(bounds):
        item = CATALOGUE["tiles"].get(tile)
        if not item:
            raise ValueError("이 지역의 연별 야간광 타일이 없습니다. 지원 위도는 대략 남북위 60~75도 이내입니다.")
        result.append({"name": item["file"], "url": "https://astrosky-black-marble.jmgj-kakao-search.workers.dev/VJ146A4-2025/compact/" + item["file"], "hash": item["compactSha256"], "bytes": item["compactBytes"]})
    return json.dumps(result)

def prepare(latitude, longitude):
    bounds = region_bounds(latitude, longitude)
    dem = prepare_dem(bounds, ROOT, allow_download=False)
    paths = [str(ROOT / CATALOGUE["tiles"][tile]["file"]) for tile in light_tiles(bounds)]
    # Original model loader checks each H5's fields, fill values and quality.
    from app.services.geospatial_assets import validate_light
    for path in paths:
        validate_light(Path(path))
    key = region_key(latitude, longitude)
    REGIONS.pop(key, None)
    REGIONS[key] = {"dem": str(dem), "blackMarble": paths, "month": None, "year": 2025}
    evicted = []
    while len(REGIONS) > 2:
        oldest = next(iter(REGIONS))
        REGIONS.pop(oldest)
        evicted.append(oldest)
    used = {path for region in REGIONS.values() for path in [region['dem'], *region['blackMarble']]}
    for file in ROOT.iterdir():
        if file.suffix in ('.tif', '.h5') and str(file) not in used:
            file.unlink()
    return json.dumps({"ready": True, "evicted": evicted})

def evaluate(payload):
    result = difficulty.evaluate_cached_weather(difficulty.CachedWeatherRequest.model_validate_json(payload))
    return json.dumps(result, allow_nan=False)
