"""Directional error aggregation: repeated samples, missing values and zenith."""
import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "tools/sky_brightness/scripts"
sys.path.insert(0, str(SCRIPTS))
from evaluator import directional_rmse, error_metrics, frozen_weather_query, load_params, save_directional_report


class DirectionalEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"az": 0, "altitude": 30, "diff": 1},
            {"az": 0, "altitude": 30, "diff": -3},
            {"az": 90, "altitude": 60, "diff": 4},
            {"az": 0, "altitude": 90, "diff": 10},
            {"az": 90, "altitude": 60, "diff": float("nan")},
        ]

    def test_rmse_pools_squared_errors_and_omits_zenith_from_azimuth(self):
        azimuth = directional_rmse(self.rows, "az").set_index("az")
        self.assertEqual(list(azimuth.index), [0, 90])
        self.assertEqual(azimuth.loc[0, "n"], 2)
        self.assertAlmostEqual(azimuth.loc[0, "rmse"], math.sqrt(5))
        self.assertEqual(azimuth.loc[90, "n"], 1)
        self.assertEqual(azimuth.loc[90, "rmse"], 4)
        altitude = directional_rmse(self.rows, "altitude").set_index("altitude")
        self.assertEqual(list(altitude.index), [30, 60, 90])
        self.assertEqual(altitude.loc[90, "rmse"], 10)
        self.assertEqual(error_metrics([row["diff"] for row in self.rows])["mse"], 31.5)

    def test_zenith_only_and_zero_error_reports_are_plottable(self):
        for rows in ([self.rows[3]], [{"az": 15, "altitude": 30, "diff": 0}]):
            with self.subTest(rows=rows), tempfile.TemporaryDirectory() as directory:
                report = save_directional_report(rows, directory)
                self.assertEqual(report["n"], 1)
                for filename in ("metrics.json", "evaluation.csv", "rmse_by_azimuth.csv",
                                 "rmse_by_altitude.csv", "rmse_by_direction.png"):
                    self.assertGreater((Path(directory) / filename).stat().st_size, 0)

    def test_empty_or_nonfinite_errors_are_not_reported_as_zero(self):
        for errors in ([], [float("nan"), float("inf")]):
            with self.assertRaises(ValueError):
                error_metrics(errors)

    def test_experimental_term_cannot_be_silently_ignored_by_runtime_evaluation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'candidate.json'
            path.write_text('{"g":0.5,"moon_cloud_gain":118}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'moon_cloud_gain'):
                load_params(str(path))

    def test_frozen_utc_weather_uses_correct_korean_observation_time(self):
        cache = SCRIPTS.parent / "research/datasets/2026-10-15_0000_KST_jeju/inputs/api_snapshot_2026-10-14_1500_UTC.json"
        query = frozen_weather_query(str(cache))
        aod, cloud, _, _, _, moon, *_ = query("2026-10-15 00:00", 33.426769, 126.530349)
        self.assertAlmostEqual(aod, 0.07)
        self.assertAlmostEqual(cloud, 0.0022580645161290325)
        self.assertAlmostEqual(moon[0], 136.32922)
        with self.assertRaises(ValueError):
            query("2026-10-15 00:00", 37.5, 127.0)
        with self.assertRaises(ValueError):
            query("2020-01-01 00:00", 33.426769, 126.530349)

    def test_modern_free_weather_needs_no_seeing_package_and_rejects_zero_pressure_endpoint(self):
        cache=SCRIPTS.parent/'research/datasets/2026-10-27_2108-2113_KST_jeju_science_high/raw/weather_cache_33.426633_126.530639_2026-10-27.json'
        query=frozen_weather_query(str(cache),'sos3d')
        with patch('requests.get',side_effect=AssertionError('network')):
            values=query('2026-10-27 21:10',33.426633,126.530639)
        self.assertAlmostEqual(values[0],.10055555555555556)
        self.assertAlmostEqual(values[1],.6694444444444444)
        self.assertEqual(values[2],2.)
        self.assertIsNone(values[3])
        self.assertTrue(query.astronomy_required)


if __name__ == "__main__":
    unittest.main()
