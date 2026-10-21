"""Offline integration/sensitivity checks against the installed global assets.

Run with PYTHONPATH=backend/src. Weather and Moon inputs are deliberately
controlled test values, not forecasts or observations. No API key is needed.
"""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from unittest.mock import patch

import numpy as np
import rasterio

from app.api.endpoints.difficulty import (
    BLACK_MARBLE_GEOMETRY_CACHE, build_environment_config,
    fetch_black_marble_dem_sqm, radiance_to_sqm,
)
from app.services.geospatial_assets import cached_region
from app.services.sky_brightness_model.core.calculator import run_pipeline

SITES = (
    ("seoul", 37.5665, 126.978), ("jeju", 33.35, 126.55),
    ("seorak", 38.119, 128.465), ("santiago", -33.4489, -70.6693),
    ("mauna-kea", 19.8206, -155.4681), ("tromso", 69.6492, 18.9553),
)
BASE = dict(aod=.1, cloudFraction=.2, cloudBaseKm=2,
            moonZenith=100, moonAzimuth=250, moonPhaseAngle=180,
            moonCloudTransmission=1)
CASES = {
    "baseline": {}, "clear": {"cloudFraction": 0},
    "overcast": {"cloudFraction": .8}, "haze": {"aod": .5},
    "full-moon-above": {"moonZenith": 45, "moonPhaseAngle": 0},
    "full-moon-below": {"moonZenith": 100, "moonPhaseAngle": 0},
}


def validate_site(name, latitude, longitude):
    region = cached_region(latitude, longitude)
    if not region:
        raise ValueError(f"{name}: local assets unavailable")
    with rasterio.open(region["dem"]) as src:
        terrain = src.read(1, masked=True)
        if np.ma.getmaskarray(terrain).any() or not np.isfinite(terrain).all():
            raise ValueError(f"{name}: incomplete terrain")
        dem = dict(shape=list(terrain.shape), minimum=float(terrain.min()), maximum=float(terrain.max()), missingPixels=0)
    BLACK_MARBLE_GEOMETRY_CACHE.clear()  # This CLI has its own process cache.
    production = fetch_black_marble_dem_sqm(latitude, longitude, BASE, 45, 180)
    if not production or production["source"] != "black-marble-dem":
        raise ValueError(f"{name}: production route fell back")
    geometry = next(iter(BLACK_MARBLE_GEOMETRY_CACHE.values()))
    rows = {}
    for case, change in CASES.items():
        environment = {**BASE, **change}
        arguments = dict(observer_coordinates=(latitude, longitude), observer_angles=(45, 180),
                         moon_angles=(environment["moonZenith"], environment["moonAzimuth"]),
                         pixel_data=geometry["pixels"], config=build_environment_config(environment),
                         dem_data=geometry["dem"], max_radius_km=production["radiusKm"])
        components = run_pipeline(**arguments, return_components=True)
        scalar = run_pipeline(**arguments)
        final = [components[f"I_{term}_final"] for term in ("ml", "art", "cloud", "bg")]
        if not all(math.isfinite(value) and value >= 0 for value in [scalar, *final]):
            raise ValueError(f"{name}/{case}: invalid radiance")
        if not math.isclose(sum(final), components["total"], rel_tol=1e-10, abs_tol=1e-15):
            raise ValueError(f"{name}/{case}: component sum mismatch")
        if not math.isclose(scalar, components["total"], rel_tol=1e-8, abs_tol=1e-15):
            raise ValueError(f"{name}/{case}: scalar/component mismatch")
        rows[case] = dict(sqm=radiance_to_sqm(scalar), components=components)
    if not math.isclose(rows["baseline"]["sqm"], production["sqm"], abs_tol=1e-9):
        raise ValueError(f"{name}: production calculation mismatch")
    if rows["full-moon-below"]["components"]["I_ml_final"] != 0:
        raise ValueError(f"{name}: Moon below horizon contributes")
    if rows["full-moon-above"]["components"]["I_ml_final"] <= 0:
        raise ValueError(f"{name}: Moon above horizon missing")
    if rows["clear"]["components"]["I_cloud_final"] != 0:
        raise ValueError(f"{name}: clear sky has cloud reflection")
    if rows["overcast"]["components"]["I_cloud_final"] <= 0:
        raise ValueError(f"{name}: cloud reflection missing")
    if math.isclose(rows["haze"]["components"]["total"], rows["baseline"]["components"]["total"], rel_tol=1e-8):
        raise ValueError(f"{name}: AOD does not affect model")
    return dict(site=name, latitude=latitude, longitude=longitude, terrain=dem,
                blackMarbleYear=production["blackMarbleYear"], pixelCount=production["blackMarblePixelCount"],
                cases=rows, passed=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".local-data/model-regions-controlled.json"))
    args = parser.parse_args()
    rows = []
    with patch("requests.get", side_effect=AssertionError("Offline validation attempted a network request")):
        for site in SITES:
            row = validate_site(*site)
            rows.append(row)
            print(f"{row['site']}: PASS · {row['pixelCount']} light pixels", flush=True)
    report = dict(kind="controlled-input-integration", createdAt=datetime.now(timezone.utc).isoformat(),
                  externalRequests=0, environment=BASE, cases=CASES, sites=rows,
                  limitation="Controlled weather/Moon inputs; not real forecasts or field accuracy validation.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved: {args.output}")


if __name__ == "__main__":
    main()
