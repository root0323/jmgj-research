"""Evaluate a frozen weather cache against observations; never edits model defaults."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import sys
from pathlib import Path

import types
SNAPSHOT = Path(__file__).resolve().parent / "models/82a295073f54"
package = types.ModuleType("frozen_model")
package.__path__ = [str(SNAPSHOT)]
sys.modules["frozen_model"] = package


def finite(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Non-finite observation/API value")
    return number


def load_inputs(args):
    from frozen_model import data_loader as loader

    cache = json.loads(args.cache.read_text(encoding="utf-8"))
    with args.observations.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise ValueError("No observations")
    environments = {}
    for row in rows:
        for name in ("lat", "lon", "zen", "az", "actual_mag"):
            row[name] = finite(row[name])
        if not (-90 <= row["lat"] <= 90 and -180 <= row["lon"] <= 180):
            raise ValueError("Invalid coordinates")
        if not (0 <= row["zen"] < 90 and 0 <= row["az"] < 360):
            raise ValueError("Expected zenith angle [0,90), azimuth [0,360)")
        key = (row["time"], row["lat"], row["lon"])
        if key in environments:
            continue
        reason = loader.cache_missing_reason(cache, row["time"])
        if reason:
            raise ValueError(reason)
        for package in cache.values():
            metadata = package["metadata"]
            if abs(finite(metadata["latitude"]) - row["lat"]) > 0.001 or abs(finite(metadata["longitude"]) - row["lon"]) > 0.001:
                raise ValueError("Cache coordinates do not match observations")
        for package, block, field in (("p1", "data_1h", "seeing_arcsec"),
                                     ("p1", "data_1h", "planet_positions"),
                                     ("p2", "data_1h", "aod550"),
                                     ("p3", "gfsensemble_1h", "totalcloudcover")):
            p = cache[package]
            i, j, _ = loader.get_package_interp_indices(p, block, row["time"])
            values = p[block][field]
            if field == "planet_positions":
                arrays = [values["moon"]["alt"], values["moon"]["az"]]
            elif field == "totalcloudcover":
                arrays = values
                if not arrays:
                    raise ValueError("Empty cloud ensemble")
            else:
                arrays = [values]
            for array in arrays:
                finite(array[i])
                finite(array[j])
        environments[key] = loader.environment_query(
            row["time"], row["lat"], row["lon"], cache_path=args.cache)
    return rows, environments


def metrics(actual, predicted):
    import numpy as np
    errors = np.asarray(predicted) - np.asarray(actual)
    return {"n": int(len(errors)), "rmse": float(np.sqrt(np.mean(errors**2))),
            "mae": float(np.mean(np.abs(errors))), "bias_pred_minus_actual": float(np.mean(errors))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observations", required=True, type=Path, help="CSV times are Korean time; zen=90-altitude.")
    parser.add_argument("--cache", required=True, type=Path, help="Explicit frozen cache; no network requests.")
    parser.add_argument("--h5", default=os.getenv("BLACK_MARBLE_H5_PATH"))
    parser.add_argument("--dem", default=os.getenv("DEM_RASTER_PATH"))
    parser.add_argument("--output", type=Path, default=Path("calibration_results"))
    parser.add_argument("--max-pixels", type=int, default=10000)
    parser.add_argument("--radius-km", type=float, default=30.0)
    parser.add_argument("--validate-inputs-only", action="store_true")
    args = parser.parse_args()
    rows, environments = load_inputs(args)
    input_summary = {"observation_count": len(rows), "time_zone": "Asia/Seoul",
                     "weather_environments": {str(k): v for k, v in environments.items()},
                     "cache_sha256": hashlib.sha256(args.cache.read_bytes()).hexdigest()}
    if args.validate_inputs_only:
        print(json.dumps(input_summary, ensure_ascii=False, indent=2))
        return
    for label, path in (("Black Marble H5", args.h5), ("terrain DEM", args.dem)):
        if not path or not Path(path).is_file():
            parser.error(f"{label} is required: supply --h5 and --dem with existing server files")
    import numpy as np
    import rasterio
    from frozen_model.calculator import prepare_pixel_geometry, run_pipeline
    from frozen_model.config import ART_SCALE_RANGE, EnvironmentConfig
    from frozen_model.data_loader import h5py, load_pixel_data_from_h5
    if h5py is None:
        parser.error("h5py is required to read Black Marble; no asset-free fallback is used")
    with rasterio.open(args.dem) as src:
        if src.crs is None or not src.crs.is_geographic:
            raise ValueError("The current model requires a geographic longitude/latitude DEM")
        dem = (src.read(1), src.transform)
    geometry = {}
    components = []
    for row in rows:
        coordinate = (row["lat"], row["lon"])
        if coordinate not in geometry:
            pixels = load_pixel_data_from_h5(args.h5, coordinate, max_radius_km=args.radius_km)
            if not pixels:
                raise ValueError("No valid Black Marble pixels; cannot evaluate this observation")
            geometry[coordinate] = prepare_pixel_geometry(
                pixels, coordinate, max_radius_km=args.radius_km, dem_data=dem,
                keep_radiance_fraction=0.99, min_pixels=50, max_pixels=args.max_pixels)
        if not geometry[coordinate]:
            raise ValueError("No prepared pixel geometry")
        aod, cloud, height, seeing, moonlight, moon_angles, phase, transmission = environments[(row["time"], *coordinate)]
        cfg = EnvironmentConfig(aod=aod, cloud_fraction=cloud, cloud_base_h=height,
                                seeing=seeing, moonlight=moonlight, moon_phase_angle_deg=phase,
                                moon_cloud_transmission=transmission)
        components.append(run_pipeline(coordinate, (row["zen"], row["az"]), moon_angles,
                                       geometry[coordinate], dem_data=dem, config=cfg,
                                       max_radius_km=args.radius_km, return_components=True))
    actual = np.array([r["actual_mag"] for r in rows])
    fixed = np.array([c["I_ml_final"] + c["I_bg_final"] for c in components])
    artificial = np.array([c["I_art_final"] + c["I_cloud_final"] for c in components])
    default_scale = EnvironmentConfig().art_scale

    def predict(scale):
        total = fixed + artificial * (scale / default_scale)
        if np.any(total <= 0) or not np.all(np.isfinite(total)):
            raise ValueError("Invalid model radiance")
        return 12.59 - 2.5 * np.log10(total * 683)

    def fit(mask):
        # One identifiable amplitude only; all physics and API inputs remain fixed.
        left, right = ART_SCALE_RANGE
        for _ in range(80):
            a = left + (right-left)/3
            b = right - (right-left)/3
            loss_a = np.mean((predict(a)[mask]-actual[mask])**2)
            loss_b = np.mean((predict(b)[mask]-actual[mask])**2)
            if loss_a <= loss_b:
                right = b
            else:
                left = a
        candidates = [ART_SCALE_RANGE[0], (left+right)/2, ART_SCALE_RANGE[1]]
        return min(candidates, key=lambda scale: np.mean((predict(scale)[mask]-actual[mask])**2))

    baseline = predict(default_scale)
    candidate_scale = fit(np.ones(len(rows), dtype=bool))
    candidate = predict(candidate_scale)
    # Spatial blocks are a diagnostic within this snapshot, not independent nights.
    groups = np.array([6 if row["zen"] == 0 else int(row["az"]//60) for row in rows])
    blocked_prediction = np.empty_like(actual)
    folds = []
    for group in sorted(set(groups)):
        test = groups == group
        scale = fit(~test)
        blocked_prediction[test] = predict(scale)[test]
        folds.append({"held_out_group": int(group), "art_scale": float(scale),
                      **metrics(actual[test], blocked_prediction[test])})
    report = {**input_summary, "baseline": metrics(actual, baseline),
              "fit_on_all_observations": metrics(actual, candidate),
              "blocked_angular_diagnostic": metrics(actual, blocked_prediction),
              "candidate_art_scale": float(candidate_scale), "folds": folds,
              "candidate_status": "diagnostic_only_not_applied",
              "limitation": "One location and time. Angular holdout is not validation across nights; ms_a/ms_b cannot be separated at one AOD. No model defaults are changed.",
              "asset_hashes": {"h5": sha256_file(args.h5), "dem": sha256_file(args.dem)},
              "geometry": {"max_pixels": args.max_pixels, "radius_km": args.radius_km}}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/"comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2),encoding="utf-8")
    output_rows = []
    for i, row in enumerate(rows):
        output_rows.append({**row, "predicted_baseline": baseline[i],
                            "predicted_candidate": candidate[i], "predicted_block_holdout": blocked_prediction[i],
                            "baseline_error": baseline[i]-actual[i], "candidate_error": candidate[i]-actual[i],
                            **components[i]})
    with (args.output/"comparison.csv").open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f,fieldnames=list(output_rows[0]))
        writer.writeheader()
        writer.writerows(output_rows)
    print(json.dumps({"baseline":report["baseline"], "candidate": report["fit_on_all_observations"],
                      "candidate_art_scale": candidate_scale, "status":report["candidate_status"]},indent=2))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path,"rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    main()
