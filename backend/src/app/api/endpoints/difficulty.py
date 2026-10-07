import json
import math
import re
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from app.local_config import setting
from app.services.geospatial_assets import cached_region, region_bounds
from app.services.sky_brightness_model.core.calculator import (
    prepare_pixel_geometry,
    run_pipeline,
)
from app.services.sky_brightness_model.core.config import EnvironmentConfig
from app.services.sky_brightness_model.core.data_loader import (
    environment_query,
    environment_from_responses,
    get_interp_indices,
    interp_value,
    shift_astro_time,
    load_pixel_data_from_h5,
)

router = APIRouter()

METEOBLUE_TIMEOUT = httpx.Timeout(4.0, connect=1.5)
SKY_BRIGHTNESS_CACHE_SECONDS = 15 * 60
SKY_BRIGHTNESS_DIRECTION_STEP_DEGREES = 2.0
SKY_BRIGHTNESS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
BLACK_MARBLE_GEOMETRY_CACHE: dict[str, dict[str, Any]] = {}

BORTLE_TO_SQM = {
    1: 22.0,
    2: 21.7,
    3: 21.3,
    4: 20.8,
    5: 20.1,
    6: 19.4,
    7: 18.7,
    8: 18.0,
    9: 17.4,
}

APP_DIR = Path(__file__).resolve().parents[2]
FEATURE_MODEL_DIR = APP_DIR / "services" / "sky_brightness_model"
FEATURE_API_CACHE_DIR = FEATURE_MODEL_DIR / "data" / "APIs"
WEATHER_CACHE_NAME_RE = re.compile(
    r"weather_cache_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)(?:_(\d{4}-\d{2}-\d{2}))?\.json$"
)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def estimate_bortle(latitude: float, longitude: float) -> int:
    near_seoul = abs(latitude - 37.5665) < 0.8 and abs(longitude - 126.978) < 0.9
    return 8 if near_seoul else 3


def sqm_from_bortle(bortle: int) -> float:
    return BORTLE_TO_SQM.get(max(1, min(9, round(bortle))), 21.3)


def quantize_direction_angle(value: float, step: float = SKY_BRIGHTNESS_DIRECTION_STEP_DEGREES) -> float:
    return round(value / step) * step


def parse_datetime(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def nearest_index(times: list[Any], target: datetime) -> int | None:
    best_index: int | None = None
    best_distance: float | None = None

    for index, raw_time in enumerate(times):
        if not isinstance(raw_time, str):
            continue
        try:
            current = parse_datetime(raw_time.replace(" ", "T"))
        except ValueError:
            continue
        distance = abs((current - target).total_seconds())
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_index = index

    return best_index


def read_series_value(data: dict[str, Any], names: list[str], index: int | None) -> float | None:
    if index is None:
        return None

    for name in names:
        values = data.get(name)
        if not isinstance(values, list) or index >= len(values):
            continue
        value = finite_number(values[index])
        if value is not None:
            return value

    return None


def read_cached_seeing(latitude: float, longitude: float, target_time: datetime) -> float | None:
    date_text = target_time.strftime("%Y-%m-%d")
    candidates = [
        FEATURE_API_CACHE_DIR / f"weather_cache_{latitude:.4f}_{longitude:.4f}_{date_text}.json",
        FEATURE_API_CACHE_DIR / f"weather_cache_{latitude:.4f}_{longitude:.4f}.json",
    ]

    nearby_candidates: list[tuple[float, Path]] = []
    for candidate in FEATURE_API_CACHE_DIR.glob(f"weather_cache_*_*_{date_text}.json"):
        match = WEATHER_CACHE_NAME_RE.match(candidate.name)
        if not match:
            continue
        cached_lat = finite_number(match.group(1))
        cached_lon = finite_number(match.group(2))
        if cached_lat is None or cached_lon is None:
            continue
        distance = math.hypot(cached_lat - latitude, cached_lon - longitude)
        if distance <= 0.05:
            nearby_candidates.append((distance, candidate))

    candidates.extend(
        candidate for _distance, candidate in sorted(nearby_candidates, key=lambda item: item[0])
    )

    for candidate in candidates:
        if not candidate.exists():
            continue
        try:
            with candidate.open("r", encoding="utf-8") as cache_file:
                payload = json.load(cache_file)
        except (OSError, json.JSONDecodeError):
            continue

        p1 = payload.get("p1") if isinstance(payload, dict) else None
        data_1h = p1.get("data_1h") if isinstance(p1, dict) else None
        if not isinstance(data_1h, dict):
            continue

        times = data_1h.get("time")
        if not isinstance(times, list):
            continue

        seeing = read_series_value(
            data_1h,
            ["seeing_arcsec", "seeing", "seeing1", "seeing2"],
            nearest_index(times, target_time),
        )
        if seeing is not None and seeing > 0:
            return seeing

    return None


def cloud_adjusted_sqm(base_sqm: float, cloud_cover_percent: float | None) -> float:
    if cloud_cover_percent is None:
        return base_sqm

    cloud_fraction = clamp(cloud_cover_percent / 100.0, 0.0, 1.0)
    # Clouds brighten light-polluted city skies by reflecting artificial light,
    # while very dark rural skies can become slightly darker because they block
    # unresolved starlight. This lightweight endpoint keeps the correction
    # conservative until the full feature/difficulty model is merged.
    if base_sqm <= 20.0:
        return clamp(base_sqm - 1.2 * cloud_fraction, 14.0, 23.0)
    return clamp(base_sqm + 0.35 * cloud_fraction, 14.0, 23.0)


def cloud_fraction_adjusted_sqm(base_sqm: float, cloud_fraction: float | None) -> float:
    if cloud_fraction is None:
        return base_sqm
    return cloud_adjusted_sqm(base_sqm, clamp(cloud_fraction, 0.0, 1.0) * 100.0)


def format_feature_model_time(target_time: datetime) -> str:
    return target_time.astimezone().strftime("%Y-%m-%d %H:%M")


def get_existing_asset_path(*env_names: str) -> Path | None:
    for env_name in env_names:
        raw_path = setting(env_name).strip().strip('"').strip("'")
        if not raw_path:
            continue
        candidate = Path(raw_path)
        if candidate.exists():
            return candidate
    return None


def radiance_to_sqm(radiance: float) -> float | None:
    number = finite_number(radiance)
    if number is None or number <= 0:
        return None
    # SQM can drop below 14 mag/arcsec² in very bright twilight or highly polluted
    # horizon directions. Keep a broad physical display range so direction changes
    # are not flattened into the same 14.00 value.
    return clamp(12.59 - 2.5 * math.log10(number * 683.0), 8.0, 23.0)


def get_float_env(name: str, default: float) -> float:
    value = finite_number(setting(name))
    return default if value is None else value


def get_int_env(name: str, default: int) -> int:
    value = finite_number(setting(name))
    return default if value is None else max(1, int(value))


def build_environment_config(feature_environment: dict[str, Any] | None):
    feature_environment = feature_environment or {}
    def value_or_default(name: str, default: float) -> float:
        value = finite_number(feature_environment.get(name))
        return default if value is None else value
    return EnvironmentConfig(
        aod=value_or_default("aod", 0.3),
        cloud_fraction=value_or_default("cloudFraction", 0.0),
        cloud_base_h=value_or_default("cloudBaseKm", 30.0),
        seeing=value_or_default("seeingArcsec", 0.0),
        moon_phase_angle_deg=value_or_default("moonPhaseAngle", 180.0),
        moon_cloud_transmission=value_or_default("moonCloudTransmission", 1.0),
    )


def get_observer_angles(altitude: float | None, azimuth: float | None) -> tuple[float, float]:
    if altitude is None or azimuth is None:
        return (0.0, 0.0)
    return (clamp(90.0 - altitude, 0.0, 89.9), clamp(azimuth, 0.0, 360.0))


def fetch_black_marble_dem_sqm(
    latitude: float,
    longitude: float,
    feature_environment: dict[str, Any] | None,
    altitude: float | None,
    azimuth: float | None,
) -> dict[str, Any] | None:
    radius_km = max(1.0, get_float_env("SKY_BRIGHTNESS_RADIUS_KM", 30.0))
    try:
        region = cached_region(latitude, longitude, radius_km)
    except ValueError:
        region = None
    h5_path = get_existing_asset_path("BLACK_MARBLE_H5_PATH", "BLACK_MARBLE_PATH")
    dem_path = get_existing_asset_path("DEM_RASTER_PATH", "DEM_PATH")
    h5_paths = [Path(p) for p in region["blackMarble"]] if region else ([h5_path] if h5_path else [])
    if region:
        dem_path = Path(region["dem"])
    if not h5_paths or dem_path is None:
        return None

    try:
        import rasterio
    except Exception:
        return None

    max_pixels = get_int_env("SKY_BRIGHTNESS_MAX_PIXELS", 1000)
    min_pixels = min(max_pixels, get_int_env("SKY_BRIGHTNESS_MIN_PIXELS", 50))
    keep_fraction = clamp(get_float_env("SKY_BRIGHTNESS_KEEP_RADIANCE_FRACTION", 0.99), 0.0, 1.0)
    fingerprints = [(str(p), p.stat().st_size, p.stat().st_mtime_ns) for p in [*h5_paths, dem_path]]
    cache_key = f"{fingerprints}|{latitude:.4f}|{longitude:.4f}|{radius_km:.1f}|{max_pixels}|{keep_fraction:.3f}"
    cached = BLACK_MARBLE_GEOMETRY_CACHE.get(cache_key)

    if cached is None:
        raw_pixels = [pixel for path in h5_paths for pixel in load_pixel_data_from_h5(str(path), (latitude, longitude), max_radius_km=radius_km)]
        if not raw_pixels:
            return None

        try:
            with rasterio.open(str(dem_path)) as src:
                from rasterio.windows import from_bounds, Window
                import numpy as np
                if src.crs != rasterio.crs.CRS.from_epsg(4326):
                    return None
                wanted = region_bounds(latitude, longitude, max(1, radius_km - 1))
                b = src.bounds
                if not (b.left <= wanted[0] and b.bottom <= wanted[1] and b.right >= wanted[2] and b.top >= wanted[3]):
                    return None
                w = from_bounds(*wanted, transform=src.transform)
                col, row = math.floor(w.col_off), math.floor(w.row_off)
                window = Window(col, row, math.ceil(w.col_off + w.width) - col, math.ceil(w.row_off + w.height) - row)
                terrain = src.read(1, window=window, masked=True)
                if np.ma.getmaskarray(terrain).any() or not np.isfinite(terrain).all() or (terrain < -500).any():
                    return None
                dem_data = (np.asarray(terrain), src.window_transform(window))
                prepared_pixels = prepare_pixel_geometry(
                    raw_pixels,
                    (latitude, longitude),
                    max_radius_km=radius_km,
                    dem_data=dem_data,
                    keep_radiance_fraction=keep_fraction,
                    min_pixels=min_pixels,
                    max_pixels=max_pixels,
                )
        except Exception:
            return None

        if not prepared_pixels:
            return None

        cached = {"pixels": prepared_pixels, "pixelCount": len(prepared_pixels), "dem": dem_data}
        if len(BLACK_MARBLE_GEOMETRY_CACHE) >= 4:
            BLACK_MARBLE_GEOMETRY_CACHE.pop(next(iter(BLACK_MARBLE_GEOMETRY_CACHE)))
        BLACK_MARBLE_GEOMETRY_CACHE[cache_key] = cached

    moon_zenith = finite_number((feature_environment or {}).get("moonZenith"))
    moon_azimuth = finite_number((feature_environment or {}).get("moonAzimuth"))
    moon_angles = (moon_zenith if moon_zenith is not None else 90.0, moon_azimuth if moon_azimuth is not None else 0.0)
    observer_angles = get_observer_angles(altitude, azimuth)

    try:
        radiance = run_pipeline(
            observer_coordinates=(latitude, longitude),
            observer_angles=observer_angles,
            moon_angles=moon_angles,
            pixel_data=cached["pixels"],
            config=build_environment_config(feature_environment),
            dem_data=cached["dem"],
            max_radius_km=radius_km,
        )
    except Exception:
        return None

    sqm = radiance_to_sqm(radiance)
    if sqm is None:
        return None

    return {
        "sqm": sqm,
        "source": "black-marble-dem",
        "blackMarblePixelCount": cached["pixelCount"],
        "radiusKm": radius_km,
        "blackMarbleMonth": region["month"] if region else None,
    }

def fetch_feature_environment(
    latitude: float,
    longitude: float,
    target_time: datetime,
) -> dict[str, Any] | None:
    """Read Meteoblue environment data through the feature/difficulty-measurement model.

    The feature branch's full SQM pipeline also needs Black Marble and DEM files that
    are not part of the branch. Until those assets are configured, this endpoint uses
    the branch's official environment_query() as the shared Meteoblue adapter and keeps
    the lightweight SQM fallback below it.
    """
    if not FEATURE_MODEL_DIR.exists():
        return None

    try:
        (
            aod,
            cloud_fraction,
            cloud_base_h,
            seeing,
            _moonlight,
            moon_angle,
            moon_phase_angle,
            moon_cloud_transmission,
        ) = environment_query(format_feature_model_time(target_time), latitude, longitude)
    except Exception:
        return None

    moon_zenith = None
    moon_azimuth = None
    if isinstance(moon_angle, (list, tuple)) and len(moon_angle) >= 2:
        moon_zenith = finite_number(moon_angle[0])
        moon_azimuth = finite_number(moon_angle[1])

    return {
        "aod": finite_number(aod),
        "cloudFraction": finite_number(cloud_fraction),
        "cloudBaseKm": finite_number(cloud_base_h),
        "seeingArcsec": finite_number(seeing),
        "moonZenith": moon_zenith,
        "moonAzimuth": moon_azimuth,
        "moonPhaseAngle": finite_number(moon_phase_angle),
        "moonCloudTransmission": finite_number(moon_cloud_transmission),
    }


async def fetch_meteoblue(
    latitude: float,
    longitude: float,
    target_time: datetime,
    package_name: str | None = None,
) -> dict[str, Any] | None:
    api_key = setting("METEOBLUE_API_KEY").strip()
    if not api_key:
        return None

    package = (
        package_name
        or setting("METEOBLUE_SKY_PACKAGE", "basic-1h").strip()
        or "basic-1h"
    )
    url = f"https://my.meteoblue.com/packages/{package}"
    params = {
        "lat": latitude,
        "lon": longitude,
        "asl": 0,
        "tz": "UTC",
        "format": "json",
        "apikey": api_key,
    }

    async with httpx.AsyncClient(timeout=METEOBLUE_TIMEOUT) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()

    data_1h = payload.get("data_1h")
    if not isinstance(data_1h, dict):
        return None

    times = data_1h.get("time")
    if not isinstance(times, list):
        return None

    index = nearest_index(times, target_time)
    cloud_cover = read_series_value(
        data_1h,
        [
            "cloudcover",
            "cloudcover_total",
            "total_cloud_cover",
            "cloud_cover",
            "cloudcover_mean",
        ],
        index,
    )
    seeing = read_series_value(data_1h, ["seeing_arcsec", "seeing"], index)

    return {
        "cloudCover": cloud_cover,
        "seeingArcsec": seeing,
        "package": package,
    }


@router.get("/sky-brightness")
async def sky_brightness(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    datetime_value: str = Query(..., alias="datetime"),
    altitude: float | None = Query(None, ge=-90, le=90),
    azimuth: float | None = Query(None, ge=0, le=360),
) -> dict[str, Any]:
    target_time = parse_datetime(datetime_value)
    altitude_value = finite_number(altitude)
    azimuth_value = finite_number(azimuth)
    if altitude_value is not None and azimuth_value is not None:
        altitude_value = clamp(quantize_direction_angle(altitude_value), -90.0, 90.0)
        azimuth_value = quantize_direction_angle(azimuth_value) % 360.0
        direction_key = f":{altitude_value:.0f}:{azimuth_value:.0f}"
    else:
        direction_key = ":zenith"
    cache_key = f"{latitude:.4f}:{longitude:.4f}:{target_time:%Y%m%d%H}{direction_key}"
    cached = SKY_BRIGHTNESS_CACHE.get(cache_key)
    now = time.time()
    if (
        cached
        and cached[0] > now
        and (finite_number(cached[1].get("seeingArcsec")) or 0.0) > 0
    ):
        return cached[1]

    bortle = estimate_bortle(latitude, longitude)
    fallback_sqm = sqm_from_bortle(bortle)
    source = "bortle-fallback"
    cloud_cover = None
    cloud_fraction = None
    cloud_base_km = None
    aod = None
    seeing = None
    moon_zenith = None
    moon_azimuth = None
    moon_phase_angle = None
    moon_cloud_transmission = None
    meteoblue_package = None
    black_marble_pixel_count = None
    sky_brightness_radius_km = None

    feature_environment = fetch_feature_environment(latitude, longitude, target_time)
    if feature_environment:
        aod = feature_environment.get("aod")
        cloud_fraction = feature_environment.get("cloudFraction")
        cloud_base_km = feature_environment.get("cloudBaseKm")
        seeing = feature_environment.get("seeingArcsec")
        moon_zenith = feature_environment.get("moonZenith")
        moon_azimuth = feature_environment.get("moonAzimuth")
        moon_phase_angle = feature_environment.get("moonPhaseAngle")
        moon_cloud_transmission = feature_environment.get("moonCloudTransmission")

    if seeing is None or seeing <= 0:
        next_seeing = read_cached_seeing(latitude, longitude, target_time)
        if next_seeing is None:
            try:
                seeing_meteoblue = await fetch_meteoblue(
                    latitude,
                    longitude,
                    target_time,
                    package_name="seeing-1h",
                )
            except (httpx.HTTPError, ValueError):
                seeing_meteoblue = None

            if seeing_meteoblue:
                next_seeing = finite_number(seeing_meteoblue.get("seeingArcsec"))
                meteoblue_package = seeing_meteoblue.get("package")

        if next_seeing is not None and next_seeing > 0:
            seeing = next_seeing
            if feature_environment is not None:
                feature_environment["seeingArcsec"] = next_seeing

    full_model = fetch_black_marble_dem_sqm(latitude, longitude, feature_environment, altitude_value, azimuth_value)
    if full_model:
        sqm = full_model["sqm"]
        source = full_model["source"]
        black_marble_pixel_count = full_model.get("blackMarblePixelCount")
        sky_brightness_radius_km = full_model.get("radiusKm")
    elif feature_environment:
        sqm = cloud_fraction_adjusted_sqm(fallback_sqm, finite_number(cloud_fraction))
        source = "feature-environment-query"
    else:
        try:
            meteoblue = await fetch_meteoblue(latitude, longitude, target_time)
        except (httpx.HTTPError, ValueError):
            meteoblue = None

        if meteoblue:
            cloud_cover = meteoblue.get("cloudCover")
            seeing = meteoblue.get("seeingArcsec")
            meteoblue_package = meteoblue.get("package")
            sqm = cloud_adjusted_sqm(fallback_sqm, finite_number(cloud_cover))
            source = "meteoblue-cloud-adjusted"
        else:
            sqm = fallback_sqm

    result = {
        "sqm": round(sqm, 3),
        "skyBrightness": round(sqm, 3),
        "muSky": round(sqm, 3),
        "unit": "mag/arcsec^2",
        "bortle": bortle,
        "source": source,
        "cloudCover": cloud_cover,
        "cloudFraction": cloud_fraction,
        "cloudBaseKm": cloud_base_km,
        "aod": aod,
        "seeingArcsec": seeing,
        "moonZenith": moon_zenith,
        "moonAzimuth": moon_azimuth,
        "moonPhaseAngle": moon_phase_angle,
        "moonCloudTransmission": moon_cloud_transmission,
        "meteobluePackage": meteoblue_package,
        "blackMarblePixelCount": black_marble_pixel_count,
        "skyBrightnessRadiusKm": sky_brightness_radius_km,
    }
    SKY_BRIGHTNESS_CACHE[cache_key] = (now + SKY_BRIGHTNESS_CACHE_SECONDS, result)
    return result


class CachedLocation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class LunarContext(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    source: str = Field(pattern="^stellarium$")
    datetime: str = Field(max_length=64)
    location: CachedLocation
    altitude: float = Field(ge=-90, le=90)
    azimuth: float = Field(ge=0, le=360)
    phaseAngle: float = Field(ge=0, le=180)


class CachedWeatherRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    location: CachedLocation
    datetime: str = Field(max_length=64)
    altitude: float | None = Field(default=None, ge=-90, le=90)
    azimuth: float | None = Field(default=None, ge=0, le=360)
    responses: dict[str, dict[str, Any]]
    astronomy: LunarContext | None = None


def cached_block(response: dict[str, Any]) -> dict[str, Any]:
    for name in ("gfsensemble_1h", "data_1h", "data_3h"):
        if isinstance(response.get(name), dict):
            return response[name]
    return {}


def cached_value(block: dict[str, Any], variable: str, target: str) -> float | None:
    """Validate a variable at this time; never turn missing/sentinel values into zero."""
    try:
        indices = get_interp_indices(block, target)
        if indices is None:
            return None
        series = block.get(variable, [])
        if not isinstance(series, list):
            return None
        if series and isinstance(series[0], list):
            values = [finite_number(interp_value(member, *indices, default=math.nan)) for member in series]
            if not values or any(value is None or value < 0 for value in values):
                return None
            return sum(values) / len(values)
        value = finite_number(interp_value(series, *indices, default=math.nan))
        return value if value is not None and value >= 0 else None
    except (TypeError, ValueError, IndexError, KeyError):
        return None


@router.post("/evaluate-cached")
def evaluate_cached_weather(payload: CachedWeatherRequest):
    """Compute using the caller's saved weather only. No Meteoblue key or I/O here.

    This route deliberately bypasses the shared GET cache and environment_query,
    so a direction/time change cannot issue a paid request or reuse another user's weather.
    """
    try:
        target_time = parse_datetime(payload.datetime)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid observation datetime")
    target = target_time.astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M")
    responses = payload.responses
    aod = cached_value(cached_block(responses.get("p2", {})), "aod550", target)
    cloud = cached_value(cached_block(responses.get("p3", {})), "totalcloudcover", target)
    pressure = cached_value(cached_block(responses.get("p4", {})), "convectivecloudbase_pressure", target)
    if pressure is not None and pressure <= 0:
        pressure = None
    seeing = cached_value(cached_block(responses.get("p1", {})), "seeing_arcsec", target)
    if seeing is not None and seeing <= 0:
        seeing = None

    latitude, longitude = payload.location.latitude, payload.location.longitude
    base = sqm_from_bortle(estimate_bortle(latitude, longitude))
    cloud_fraction = cloud / 100 if cloud is not None and cloud <= 100 else None
    sqm = cloud_fraction_adjusted_sqm(base, cloud_fraction)
    source = "cached-weather-fallback" if cloud_fraction is not None else "bortle-fallback"
    environment = None
    model = None
    missing = []
    if aod is None:
        missing.append("aod550")
    if cloud_fraction is None:
        missing.append("totalcloudcover")
    if pressure is None:
        missing.append("convectivecloudbase_pressure")
    # Seeing does not enter the radiative brightness model. Keep it optional;
    # never invent an arcsecond value from wind/clouds to satisfy this route.

    moon_block = cached_block(responses.get("p1", {}))
    positions = moon_block.get("planet_positions", {})
    moon = positions.get("moon", {}) if isinstance(positions, dict) else {}
    moon_valid = False
    try:
        moon_indices = get_interp_indices(moon_block, shift_astro_time(target))
        if moon_indices is not None and isinstance(moon, dict):
            moon_alt = finite_number(interp_value(moon.get("alt", []), *moon_indices, default=math.nan))
            moon_az = finite_number(interp_value(moon.get("az", []), *moon_indices, default=math.nan))
            moon_valid = moon_alt is not None and -90 <= moon_alt <= 90 and moon_az is not None and 0 <= moon_az <= 360
    except (TypeError, ValueError, IndexError):
        pass
    astronomy = payload.astronomy
    if astronomy:
        try:
            same_time = abs((parse_datetime(astronomy.datetime) - target_time).total_seconds()) < 1
        except ValueError:
            same_time = False
        same_location = abs(astronomy.location.latitude - latitude) < 0.00001 and abs(astronomy.location.longitude - longitude) < 0.00001
        if not same_time or not same_location:
            raise HTTPException(status_code=422, detail="Moon context must match the observation time and location")
        moon_valid = True
    if not moon_valid:
        missing.append("moon_position")

    if aod is not None and cloud_fraction is not None:
        parsed = environment_from_responses(target, responses)
        environment = {
            "aod": clamp(aod, 0, 5), "cloudFraction": cloud_fraction, "cloudBaseKm": parsed[2],
            "seeingArcsec": seeing, "moonZenith": parsed[5][0] if moon_valid else None,
            "moonAzimuth": parsed[5][1] if moon_valid else None,
            "moonPhaseAngle": parsed[6], "moonCloudTransmission": parsed[7],
        }
        if astronomy:
            environment.update(moonZenith=90 - astronomy.altitude, moonAzimuth=astronomy.azimuth,
                               moonPhaseAngle=astronomy.phaseAngle)
        if not missing:
            model = fetch_black_marble_dem_sqm(latitude, longitude, environment, payload.altitude, payload.azimuth)
            if model:
                sqm, source = model["sqm"], model["source"]
    return {
        "sqm": round(sqm, 3), "source": source, "seeingArcsec": seeing,
        "environment": environment, "missing": missing,
        "blackMarblePixelCount": (model or {}).get("blackMarblePixelCount"),
        "blackMarbleMonth": (model or {}).get("blackMarbleMonth"),
        "assetsReady": model is not None,
    }
