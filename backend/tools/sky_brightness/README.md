# Sky Brightness Model Tools

This directory contains research and evaluation scripts for the Black Marble +
DEM sky-brightness model. Runtime code lives under:

```text
backend/src/app/services/sky_brightness_model/
  core/
    config.py
    data_loader.py
    calculator.py
  data/csv/
    ac_mag.csv
    ac_mag_moon.csv
    component_residuals.csv
```

The FastAPI endpoint imports the runtime model through the normal application
package:

```python
from app.services.sky_brightness_model.core.calculator import run_pipeline
```

The large Black Marble H5 and DEM raster files are not stored in Git. Configure
their paths through environment variables:

```env
BLACK_MARBLE_H5_PATH=/tmp/jmgj-assets/black_marble/black-marble.h5
DEM_RASTER_PATH=/tmp/jmgj-assets/dem/korea-dem.img
```

## Scripts

Run scripts from `backend/tools/sky_brightness/scripts`.

```powershell
python evaluator.py --params path\to\best_params.json
python optimizer.py --trials 100 --max-pixels 10000
python kfold_evaluator.py --trials 30 --group-by date
python component_residual_plots.py --y-mode radiance
python main.py --max-pixels 10000
```

Install the research dependencies with `python -m pip install -r backend/tools/sky_brightness/requirements.txt`
from the repository root.

### Directional RMSE evaluation

`evaluator.py` now writes `evaluation.csv`, `metrics.json`, `rmse_by_azimuth.csv`,
`rmse_by_altitude.csv`, and `rmse_by_direction.png` to `--output-dir` (default:
`backend/tools/sky_brightness/data/evaluation`). Choose a new output directory for
each archived research run.

The observation CSV requires `time,lat,lon,zen,az,actual_mag`. Angles are degrees:
`zen = 90 - altitude`, and azimuth is north=0, east=90. Metrics use predicted SQM
minus observed SQM: MSE is the mean squared error, RMSE its square root. Each
directional group pools **squared sample errors**, then takes the square root;
it does not average per-sample absolute errors or per-group RMSEs. Exact equal
azimuths/altitudes are grouped across other coordinates and times. Zenith is
included in altitude/overall metrics and excluded from azimuth metrics. Each
plot point displays its sample count; n=1 is an absolute error. Empty directions
are left blank. An altitude sweep with only 30 and 90 degrees produces only two
altitude points.

Use `--weather-cache` to evaluate the archived API data without network requests,
API keys, or changes to the application's weather cache. This option reuses the
timezone-aware research adapter archived in `research/models/82a295073f54/`;
the calculator and default coefficients still come from the **current runtime
model**. Observation times are KST; each API package's `metadata.utc_timeoffset`
determines its time axis. Missing weather coverage, mismatched locations, or
invalid observation rows stop this offline evaluation instead of being skipped.

From the repository root:

```powershell
python backend/tools/sky_brightness/scripts/evaluator.py --csv backend/tools/sky_brightness/research/datasets/2026-10-15_0000_KST_jeju/inputs/v002_unobstructed_21.csv --weather-cache backend/tools/sky_brightness/research/datasets/2026-10-15_0000_KST_jeju/inputs/api_snapshot_2026-10-14_1500_UTC.json --h5 <Black-Marble-H5> --dem <DEM-raster> --max-pixels 1000 --output-dir <new-run-directory>
```

`evaluator.py` scores a fixed model on supplied observations. It does not fit
parameters or establish independent validation when those observations were
used for calibration. `kfold_evaluator.py` fits coefficients using all but one
date (or date-hour), evaluates the held-out group, and repeats for each group.
It requires at least two groups. Its printed mean fold RMSE weights groups
equally, which differs from a pooled RMSE if group sizes differ. The single-time
Jeju data cannot support date-based cross-validation. The existing research
angular holdouts are diagnostics within one night, not validation across nights.

The current data set is the [2026-10-22 SQM-L sweep](research/datasets/2026-10-22_2123-2218_KST_jeju/).
It includes all 49 readings and new native three-hour weather. `research/calibrate_three_hour.py`
fits existing runtime parameters; `research/calibrate_scattering.py` additionally compares an
explicitly empirical cloud/moon-scattering term. Both preserve fixed-physics baselines and
directional held-out results. The new term is research-only; `evaluator.py --params` rejects
unsupported fields instead of silently ignoring them. `research/capture_weather.py` captures
the app's three weather packages with a process-only key and redacts credentials before saving.

Common defaults are defined in `scripts/cli_common.py`.

## Common Arguments

| Argument | Default | Meaning |
| --- | --- | --- |
| `--csv` | `backend/src/app/services/sky_brightness_model/data/csv/ac_mag.csv` | observation CSV |
| `--h5` | `BLACK_MARBLE_H5_PATH` | Black Marble H5 file |
| `--dem` | `DEM_RASTER_PATH` | DEM raster file |
| `--radius-km` | `30.0` | search radius around observer |
| `--keep-radiance-fraction` | `0.99` | retained cumulative radiance fraction |
| `--min-pixels` | `50` | minimum number of pixels |
| `--max-pixels` | `10000` | maximum number of pixels |

