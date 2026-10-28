import argparse
import importlib.util
import json
import os
import sys
import hashlib
import shutil
from dataclasses import asdict
from datetime import datetime,timezone
from pathlib import Path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(SCRIPT_DIR)))
SRC_DIR = os.path.join(BACKEND_DIR, "src")
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

import numpy as np
import pandas as pd
import rasterio

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CODE_DIR = os.path.dirname(SCRIPT_DIR)
if CODE_DIR not in sys.path:
    sys.path.insert(0, CODE_DIR)

from app.services.sky_brightness_model.core.calculator import calculate_directional_shielding, prepare_pixel_geometry, run_pipeline
from app.services.sky_brightness_model.core.config import (
    DEFAULT_ART_SCALE,
    EnvironmentConfig,
    FIXED_GAMMA,
    FIXED_G,
    FIXED_OMEGA_A,
    FIXED_Q,
    FIXED_Q_DIRECT,
    FIXED_RHO_ALBEDO,
    DEFAULT_MOON_TRANSMISSION_SCALE,
    ACTIVE_PHYSICS_MODEL,
)
from app.services.sky_brightness_model.core.data_loader import (
    environment_query, load_pixel_data_from_h5, interp_positive_value,pressure_to_cloud_base_height_km,
)
from cli_common import (
    DEFAULT_CSV_PATH,
    DEFAULT_DEM_PATH,
    DEFAULT_FALLBACK_CSV_PATH,
    DEFAULT_H5_PATH,
    add_data_args,
)

CSV_FILE_PATH = DEFAULT_CSV_PATH
H5_FILE_PATH = DEFAULT_H5_PATH
DEM_IMG_PATH = DEFAULT_DEM_PATH


def magnitude_from_radiance(radiance: float) -> float:
    if radiance <= 0 or not np.isfinite(radiance):
        return np.nan
    return 12.59 - 2.5 * np.log10(radiance * 683)


def angular_separation_deg(angle_a: tuple[float, float], angle_b: tuple[float, float]) -> float:
    z1, az1 = np.radians(angle_a)
    z2, az2 = np.radians(angle_b)
    cos_sep = np.cos(z1) * np.cos(z2) + np.sin(z1) * np.sin(z2) * np.cos(az1 - az2)
    return float(np.degrees(np.arccos(np.clip(cos_sep, -1.0, 1.0))))


def load_params(path: str | None) -> dict:
    if not path:
        return {}

    with open(path, "r", encoding="utf-8") as f:
        params = json.load(f)

    if not isinstance(params, dict):
        raise ValueError("Parameter file must contain a JSON object.")
    supported = {"gamma", "omega_a", "g", "ms_a", "ms_b", "moon_transmission_scale",
                 "art_scale", "Q", "q", "rho_albedo", "physics_model", "cloud_optical_depth",
                 "cloud_liquid_water_path_kg_m2", "cloud_effective_radius_um", "instrument_fwhm_deg"}
    unsupported = set(params) - supported
    if unsupported:
        raise ValueError(f"Unsupported runtime evaluation parameters: {sorted(unsupported)}. "
                         "Use the matching research runner for experimental model terms.")

    return params


def frozen_weather_query(cache_path: str,physics_model="legacy"):
    """Reuse the archived, timezone-aware research adapter without API calls."""
    adapter_path = Path(CODE_DIR) / "research/models/82a295073f54/data_loader.py"
    name = "app.services.sky_brightness_model.core._evaluation_weather"
    spec = importlib.util.spec_from_file_location(name, adapter_path)
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    with open(cache_path, encoding="utf-8") as source:
        cache = json.load(source)
    astronomy_required=physics_model=='sos3d' or 'p1' not in cache

    def query(time, lat, lon):
        for package in (("p2","p3","p4") if astronomy_required else ("p1", "p2", "p3", "p4")):
            metadata = cache[package]["metadata"]
            coordinates = np.asarray([metadata["latitude"], metadata["longitude"]], dtype=float)
            if (not np.isfinite(coordinates).all()
                    or abs(coordinates[0] - lat) > 0.001 or abs(coordinates[1] - lon) > 0.001):
                raise ValueError(f"{package}: weather cache coordinates do not match observations")
        if astronomy_required:
            fields={}
            for package,field in [('p2','aod550'),('p3','totalcloudcover'),('p4','convectivecloudbase_pressure')]:
                response=cache[package]
                block=next((name for name in ('data_3h','data_1h','gfsensemble_1h') if isinstance(response.get(name),dict)),None)
                if block is None:
                    raise ValueError(f'{package}: missing weather time series')
                indices=adapter.get_package_interp_indices(response,block,time)
                if indices is None:
                    raise ValueError(f'{package}: weather does not bracket observation time')
                series=response[block].get(field,[])
                if package=='p4':
                    fields[field]=interp_positive_value(series,*indices)
                else:
                    left,right,fraction=indices
                    if series and isinstance(series[0],list):
                        raw=np.asarray([[member[left],member[right]] for member in series],dtype=float)
                        if not np.isfinite(raw).all() or np.min(raw)<0:
                            raise ValueError(f'{field}: invalid ensemble endpoint')
                        values=raw.mean(axis=0)
                    else:
                        values=np.asarray([series[left],series[right]],dtype=float)
                    if not np.isfinite(values).all() or np.min(values)<0:
                        raise ValueError(f'{field}: invalid interpolation endpoint')
                    fields[field]=float(values[0]+(values[1]-values[0])*fraction)
            aod=fields['aod550'];cloud=fields['totalcloudcover']/100
            if not 0<=aod<=5 or not 0<=cloud<=1:
                raise ValueError('AOD/cloud outside physical range')
            pressure=fields['convectivecloudbase_pressure']
            height=pressure_to_cloud_base_height_km(pressure,1.) if pressure is not None else 2.
            # Seeing is unused by this brightness calculation and remains absent.
            # The placeholders below are replaced by Astronomy Engine before use.
            return aod,cloud,height,None,0.,(90.,0.),180.,1.
        return adapter.environment_query(time, lat, lon, cache_path=cache_path)

    query.astronomy_required=astronomy_required
    return query


def build_config(row_data: dict, params: dict) -> EnvironmentConfig:
    blended = {
        "gamma": params.get("gamma", FIXED_GAMMA),
        "omega_a": params.get("omega_a"),
        "g": params.get("g"),
        "ms_a": params.get("ms_a"),
        "ms_b": params.get("ms_b"),
    }

    return EnvironmentConfig(
        physics_model=params.get("physics_model", ACTIVE_PHYSICS_MODEL),
        cloud_optical_depth=params.get("cloud_optical_depth"),
        cloud_liquid_water_path_kg_m2=params.get("cloud_liquid_water_path_kg_m2"),
        cloud_effective_radius_um=params.get("cloud_effective_radius_um",10.),
        instrument_fwhm_deg=params.get("instrument_fwhm_deg",20.),
        aod=row_data["aod"],
        cloud_fraction=row_data["cloud_fraction"],
        cloud_base_h=row_data["cloud_base_h"],
        seeing=row_data["seeing"],
        moonlight=row_data["moonlight"],
        moon_phase_angle_deg=row_data.get("moon_phase_angle", 180.0),
        moon_cloud_transmission=row_data.get("moon_cloud_transmission", 1.0),
        moon_transmission_scale=params.get(
            "moon_transmission_scale", DEFAULT_MOON_TRANSMISSION_SCALE
        ),
        art_scale=params.get("art_scale", DEFAULT_ART_SCALE),
        gamma=blended["gamma"],
        omega_a=blended["omega_a"],
        g=blended["g"],
        Q=params.get("Q", FIXED_Q),
        q=params.get("q", FIXED_Q_DIRECT),
        ms_a=blended["ms_a"],
        ms_b=blended["ms_b"],
        rho_albedo=params.get("rho_albedo", FIXED_RHO_ALBEDO),
    )


def preload_cases(
    csv_path: str,
    h5_path: str,
    dem_path: str,
    radius_km: float,
    keep_radiance_fraction: float = 0.99,
    min_pixels: int = 50,
    max_pixels: int = 200,
    *,
    weather_cache: str | None = None,
    physics_model: str = ACTIVE_PHYSICS_MODEL,
) -> list[dict]:
    cases = []
    df = pd.read_csv(csv_path)
    query_environment = frozen_weather_query(weather_cache,physics_model) if weather_cache else environment_query

    with rasterio.open(dem_path) as src:
        dem_data = (src.read(1), src.transform)

    for i, row in df.iterrows():
        try:
            lat = float(row["lat"])
            lon = float(row["lon"])
            zen = float(row["zen"])
            az = float(row["az"])
            actual_mag = float(row["actual_mag"])
            time_str = str(row["time"])

            if not np.isfinite([lat, lon, zen, az, actual_mag]).all():
                raise ValueError("invalid numeric value")
            if not (0 <= zen < 90 and 0 <= az < 360):
                raise ValueError("Expected zenith angle [0,90), azimuth [0,360)")

            observer_coordinates = (lat, lon)
            observer_angles = (zen, az)

            aod, cloud_fraction, cloud_base_h, seeing, moonlight, moon_angles, moon_phase_angle, moon_cloud_transmission = query_environment(
                time_str, lat, lon
            )
            if physics_model=='sos3d' or getattr(query_environment,'astronomy_required',False):
                # A stale seeing package must not supply the Moon's direction.
                # Research-only dependency; app astronomy comes from Stellarium.
                import astronomy
                from datetime import datetime,timezone
                instant=datetime.fromisoformat(time_str+'+09:00').astimezone(timezone.utc)
                t=astronomy.Time.Make(instant.year,instant.month,instant.day,instant.hour,instant.minute,instant.second)
                rr,cc=rasterio.transform.rowcol(dem_data[1],lon,lat)
                height=float(dem_data[0][rr,cc]) if 0<=rr<dem_data[0].shape[0] and 0<=cc<dem_data[0].shape[1] else 0.
                observer=astronomy.Observer(lat,lon,height)
                eq=astronomy.Equator(astronomy.Body.Moon,t,observer,True,True)
                horizon=astronomy.Horizon(t,observer,eq.ra,eq.dec,astronomy.Refraction.Normal)
                moon_angles=(90-horizon.altitude,horizon.azimuth)
                moon_phase_angle=astronomy.Illumination(astronomy.Body.Moon,t).phase_angle

            pixel_data = load_pixel_data_from_h5(
                h5_path, observer_coordinates, max_radius_km=radius_km
            )
            pixel_data = prepare_pixel_geometry(
                pixel_data,
                observer_coordinates,
                max_radius_km=radius_km,
                dem_data=dem_data,
                keep_radiance_fraction=keep_radiance_fraction,
                min_pixels=min_pixels,
                max_pixels=max_pixels,
            )
            if not pixel_data:
                raise ValueError("no satellite pixels")

            moon_shield_deg = calculate_directional_shielding(
                observer_coordinates,
                moon_angles[1],
                dem_data[0],
                dem_data[1],
                max_dist_km=30.0,
            )

            cases.append(
                {
                    "row_no": i + 1,
                    "time": time_str,
                    "actual_mag": actual_mag,
                    "observer_coordinates": observer_coordinates,
                    "observer_angles": observer_angles,
                    "moon_angles": moon_angles,
                    "pixel_data": pixel_data,
                    "dem_data": dem_data,
                    "moon_shield_deg": moon_shield_deg,
                    "aod": aod,
                    "cloud_fraction": cloud_fraction,
                    "cloud_base_h": cloud_base_h,
                    "seeing": seeing,
                    "moonlight": moonlight,
                    "moon_phase_angle": moon_phase_angle,
                    "moon_cloud_transmission": moon_cloud_transmission,
                    "radius_km": radius_km,
                }
            )
            print(f"[load] row {i + 1}: ready")
        except Exception as exc:
            if weather_cache:
                raise ValueError(f"Offline evaluation failed at row {i + 1}: {exc}") from exc
            print(f"[skip] row {i + 1}: {exc}")

    return cases


def evaluate(cases: list[dict], params: dict) -> list[dict]:
    results = []

    for case in cases:
        config = build_config(case, params)
        radiance = run_pipeline(
            observer_coordinates=case["observer_coordinates"],
            observer_angles=case["observer_angles"],
            moon_angles=case["moon_angles"],
            pixel_data=case["pixel_data"],
            dem_data=case["dem_data"],
            config=config,
            precalc_moon_shield=case["moon_shield_deg"],
            max_radius_km=case.get("radius_km", 30.0),
        )
        pred_mag = magnitude_from_radiance(radiance)
        diff = pred_mag - case["actual_mag"]

        results.append(
            {
                "row_no": case["row_no"],
                "time": case.get("time", ""),
                "lat": case["observer_coordinates"][0],
                "lon": case["observer_coordinates"][1],
                "zen": case["observer_angles"][0],
                "az": case["observer_angles"][1],
                "altitude": 90.0 - case["observer_angles"][0],
                "pred_mag": pred_mag,
                "actual_mag": case["actual_mag"],
                "diff": diff,
                "radiance": radiance,
                "moon_sep_deg": angular_separation_deg(case["observer_angles"], case["moon_angles"]),
                "moon_phase_angle": case.get("moon_phase_angle", np.nan),
                "moon_cloud_transmission": case.get("moon_cloud_transmission", np.nan),
                "cloud_fraction": config.cloud_fraction,
                "cloud_effect_fraction": getattr(config, "cloud_effect_fraction", config.cloud_fraction),
                "cloud_base_h": config.cloud_base_h,
                "H_max": config.H_max,
                "Q": config.Q,
                "q": config.q,
                "rho_albedo": config.rho_albedo,
            }
        )

    return results


def error_metrics(diffs) -> dict:
    errors = np.asarray(diffs, dtype=float)
    errors = errors[np.isfinite(errors)]
    if not len(errors):
        raise ValueError("No finite prediction errors to evaluate.")
    mse = float(np.mean(errors**2))
    return {"n": int(len(errors)), "mse": mse, "rmse": float(np.sqrt(mse)),
            "mae": float(np.mean(np.abs(errors))), "bias": float(np.mean(errors))}


def directional_rmse(results: list[dict], angle: str) -> pd.DataFrame:
    """Pool squared errors at each exact angle, excluding zenith from azimuth."""
    if angle not in ("az", "altitude"):
        raise ValueError("angle must be az or altitude")
    groups = {}
    for row in results:
        if not np.isfinite([row["diff"], row[angle], row["altitude"]]).all():
            continue
        if angle == "az" and np.isclose(row["altitude"], 90.0, atol=1e-8, rtol=0):
            continue
        value = float(row[angle])
        groups.setdefault(value, []).append(row["diff"])
    return pd.DataFrame(
        [{angle: value, **error_metrics(errors)} for value, errors in sorted(groups.items())],
        columns=[angle, "n", "mse", "rmse", "mae", "bias"],
    )


def save_directional_report(results: list[dict], output_dir: str) -> dict:
    # Lazy import: numerical evaluation and other scripts do not require plotting.
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    metrics = error_metrics([row["diff"] for row in results])
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(results).to_csv(destination / "evaluation.csv", index=False)
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), layout="constrained")
    for ax, angle, title, limit in zip(
        axes, ("az", "altitude"),
        ("RMSE by azimuth (zenith excluded)", "RMSE by altitude"), (360, 90),
    ):
        grouped = directional_rmse(results, angle)
        filename = "rmse_by_azimuth.csv" if angle == "az" else "rmse_by_altitude.csv"
        grouped.to_csv(destination / filename, index=False)
        ax.vlines(grouped[angle], 0, grouped["rmse"], color="#2563eb", alpha=0.35)
        ax.scatter(grouped[angle], grouped["rmse"], color="#2563eb", zorder=3)
        for row in grouped.to_dict("records"):
            ax.annotate(f"n={row['n']}", (row[angle], row["rmse"]),
                        xytext=(0, 7), textcoords="offset points", ha="center", fontsize=7)
        if grouped.empty:
            ax.text(0.5, 0.5, "No directional observations", transform=ax.transAxes, ha="center")
        ax.set(title=title, xlabel="Azimuth (degrees, N=0, E=90)" if angle == "az" else "Altitude (degrees)",
               ylabel="RMSE (mag/arcsec²)", xlim=(-5, limit + 5))
        ax.set_xticks(np.arange(0, limit + 1, 30 if angle == "az" else 15))
        ax.set_ylim(bottom=0, top=max(0.1, grouped["rmse"].max() * 1.2) if not grouped.empty else 0.1)
        ax.grid(alpha=0.2)
    fig.suptitle(f"Directional model error | n={metrics['n']} | MSE={metrics['mse']:.5f} | RMSE={metrics['rmse']:.5f}\n"
                 "Exact-angle groups pooled over other coordinates; n=1 means absolute error.", fontsize=11)
    fig.savefig(destination / "rmse_by_direction.png", dpi=180)
    plt.close(fig)
    report = {**metrics, "error_definition": "predicted SQM - observed SQM",
              "rmse_unit": "mag/arcsec^2", "mse_unit": "(mag/arcsec^2)^2",
              "grouping": "Exact angles; squared errors pooled across all other coordinates and times.",
              "azimuth_excludes_zenith": True,
              "invalid_error_rows": len(results) - metrics["n"]}
    (destination / "metrics.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return report


def print_report(results: list[dict]) -> None:
    valid = [r for r in results if np.isfinite(r["diff"])]
    if not valid:
        print("No valid evaluation results.")
        return

    diffs = np.array([r["diff"] for r in valid], dtype=float)
    metrics = error_metrics(diffs)
    mse, rmse, bias, mae = (metrics[key] for key in ("mse", "rmse", "bias", "mae"))

    print()
    print(f"{'No':<5} | {'Time':<16} | {'Pred':>9} | {'Actual':>9} | {'Diff':>9} | {'MoonSep':>7} | {'C':>5} | {'Ce':>5} | {'Hmax':>6} | {'q':>5}")
    print("-" * 106)
    for r in valid:
        print(
            f"{r['row_no']:<5} | "
            f"{str(r.get('time', '')):<16} | "
            f"{r['pred_mag']:>9.4f} | "
            f"{r['actual_mag']:>9.4f} | "
            f"{r['diff']:>+9.4f} | "
            f"{r['moon_sep_deg']:>7.2f} | "
            f"{r['cloud_fraction']:>5.2f} | "
            f"{r['cloud_effect_fraction']:>5.2f} | "
            f"{r['H_max']:>6.2f} | "
            f"{r['q']:>5.2f}"
        )
    print("-" * 106)
    print(f"MSE : {mse:.5f}")
    print(f"RMSE: {rmse:.5f}")
    print(f"Bias: {bias:+.5f}")
    print(f"MAE : {mae:.5f}")
    print(f"Check: bias^2 <= MSE -> {bias * bias:.5f} <= {mse:.5f}")

    grouped = {}
    for r in valid:
        time_key = str(r.get("time", ""))[:13]
        grouped.setdefault(time_key, []).append(r["diff"])

    if grouped:
        print()
        print("Time-group bias:")
        for time_key in sorted(grouped):
            group_diffs = np.array(grouped[time_key], dtype=float)
            group_mse = float(np.mean(group_diffs**2))
            print(
                f"{time_key:<13} | n={len(group_diffs):>3} | "
                f"MSE={group_mse:.5f} | Bias={np.mean(group_diffs):+.5f} | "
                f"MAE={np.mean(np.abs(group_diffs)):.5f}"
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate light pollution model predictions.")
    parser.add_argument("--params", help="JSON file containing model parameters.", default=None)
    parser.add_argument("--physics-model",choices=['sos3d','legacy'],default=None,
                        help="Default: current SOS physics, or physics_model in the parameter file.")
    parser.add_argument("--instrument-response",choices=['sqm-l','sky'],default='sqm-l',
                        help="Fixed SQM-L Gaussian 20-degree FWHM, or resolved sky radiance.")
    parser.add_argument("--cloud-optical-depth",type=float,default=None,
                        help="Explicit cloud optical-thickness scenario; not inferred from cloud fraction.")
    parser.add_argument("--fallback-csv", default=DEFAULT_FALLBACK_CSV_PATH)
    parser.add_argument("--weather-cache", help="Frozen API JSON; KST observation times, metadata-aware offline adapter.")
    parser.add_argument("--output-dir", default=None,
                        help="Directory for predictions, metrics, grouped errors, and RMSE plot.")
    add_data_args(parser)
    args = parser.parse_args()

    params = load_params(args.params)
    args.physics_model=args.physics_model or params.get('physics_model',ACTIVE_PHYSICS_MODEL)
    params.update(physics_model=args.physics_model,
                  instrument_fwhm_deg=20. if args.instrument_response=='sqm-l' else None)
    if args.cloud_optical_depth is not None:
        params['cloud_optical_depth']=args.cloud_optical_depth
    print(f"Parameters: {params if params else 'EnvironmentConfig defaults'}")

    if args.weather_cache and not os.path.exists(args.csv):
        raise FileNotFoundError(args.csv)
    csv_path = args.csv if os.path.exists(args.csv) else args.fallback_csv
    if csv_path != args.csv:
        print(f"Evaluation CSV not found; fallback: {csv_path}")
    if args.output_dir is None:
        args.output_dir=str(Path(CODE_DIR)/'data/evaluation'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    output=Path(args.output_dir)
    if output.exists() and any(output.iterdir()):
        raise FileExistsError('Choose a new output directory; previous research is retained.')
    output.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(csv_path,output/'input.csv')
    conditions={'parameters':params,'inputs_sha256':{}}
    for label,path in [('observations',csv_path),('weather',args.weather_cache),('h5',args.h5),('dem',args.dem)]:
        if path:
            conditions['inputs_sha256'][label]=hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if args.weather_cache:
        shutil.copyfile(args.weather_cache,output/'weather.json')
    (output/'run_conditions.json').write_text(json.dumps(conditions,indent=2,allow_nan=False)+'\n',encoding='utf-8')

    cases = preload_cases(
        csv_path,
        args.h5,
        args.dem,
        args.radius_km,
        args.keep_radiance_fraction,
        args.min_pixels,
        args.max_pixels,
        weather_cache=args.weather_cache,
        physics_model=args.physics_model,
    )
    results = evaluate(cases, params)
    environments={}
    for case in cases:
        key=f"{case['time']}|{case['observer_coordinates']}"
        environments.setdefault(key,{'config':asdict(build_config(case,params)),
                                             'moon_angles_deg':case['moon_angles']})
    conditions['resolved_environments']=environments
    (output/'run_conditions.json').write_text(json.dumps(conditions,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print_report(results)
    save_directional_report(results, args.output_dir)
    print(f"Directional RMSE plot and tables saved: {args.output_dir}")


if __name__ == "__main__":
    main()

