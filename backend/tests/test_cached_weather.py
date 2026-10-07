import copy
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.api.endpoints.difficulty import build_environment_config
from app.services.sky_brightness_model.core.data_loader import environment_from_responses


def fixture():
    times = [f"2026-10-05 {hour:02d}:00" for hour in range(24)]
    return {
        "p1": {"data_1h": {"time": times, "seeing_arcsec": [1 if h % 2 == 0 else 3 for h in range(24)],
               "planet_positions": {"moon": {"az": [350 if h % 2 == 0 else 10 for h in range(24)], "alt": [20] * 24}}}},
        "p2": {"data_1h": {"time": times, "aod550": [0] * 24}},
        "p3": {"gfsensemble_1h": {"time": times, "totalcloudcover": [[0] * 24, [40] * 24]}},
        "p4": {"data_1h": {"time": times, "convectivecloudbase_pressure": [900] * 24}},
    }


def payload(responses=None):
    return {"location": {"latitude": 37.5665, "longitude": 126.978}, "datetime": "2026-10-05T10:30:00Z",
            "altitude": 45, "azimuth": 180, "responses": responses if responses is not None else fixture()}


class CachedWeatherTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_original_interpolation_and_lunar_convention_are_preserved(self):
        values = environment_from_responses("2026-10-05 19:30", fixture())
        self.assertEqual(values[0], 0)
        self.assertAlmostEqual(values[1], .2)
        self.assertEqual(values[3], 2)
        self.assertEqual(values[5], (70, 0))
        self.assertGreater(values[2], 0)
        self.assertLess(values[2], 3)

    def test_three_hour_normalization_does_not_mutate_saved_payload(self):
        responses = fixture()
        responses["p2"]["data_3h"] = responses["p2"].pop("data_1h")
        responses["p3"]["data_3h"] = {"time": responses["p2"]["data_3h"]["time"], "totalcloudcover": [20] * 24}
        responses["p3"].pop("gfsensemble_1h")
        before = copy.deepcopy(responses)
        self.assertAlmostEqual(environment_from_responses("2026-10-05 19:30", responses)[1], .2)
        self.assertEqual(responses, before)

    def test_cached_route_never_reads_a_key_or_fetches_weather(self):
        with patch("app.api.endpoints.difficulty.environment_query", side_effect=AssertionError("paid call")), \
             patch("requests.get", side_effect=AssertionError("network")), \
             patch("app.services.sky_brightness_model.core.data_loader.get_meteoblue_api_key", side_effect=AssertionError("key read")), \
             patch("app.api.endpoints.difficulty.fetch_black_marble_dem_sqm", return_value=None):
            for altitude in (15, 45, 75):
                data = payload()
                data["altitude"] = altitude
                result = self.client.post("/api/difficulty/evaluate-cached", json=data)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()["seeingArcsec"], 2)
                self.assertEqual(result.json()["source"], "cached-weather-fallback")

    def test_complete_saved_data_reaches_model_with_no_cross_request_cache(self):
        with patch("app.api.endpoints.difficulty.fetch_black_marble_dem_sqm", return_value={"sqm": 20.5, "source": "black-marble-dem"}) as model:
            first = self.client.post("/api/difficulty/evaluate-cached", json=payload()).json()
            changed = fixture()
            changed["p2"]["data_1h"]["aod550"] = [.5] * 24
            self.client.post("/api/difficulty/evaluate-cached", json=payload(changed))
            self.assertEqual(first["sqm"], 20.5)
            self.assertEqual(model.call_count, 2)
            self.assertEqual(model.call_args.args[2]["aod"], .5)

    def test_missing_or_out_of_range_data_cannot_be_used_as_clear_sky(self):
        with patch("app.api.endpoints.difficulty.fetch_black_marble_dem_sqm") as model:
            data = payload()
            data["datetime"] = "2026-10-07T10:30:00Z"
            response = self.client.post("/api/difficulty/evaluate-cached", json=data)
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(result["source"], "bortle-fallback")
            self.assertIsNone(result["seeingArcsec"])
            self.assertIn("aod550", result["missing"])
            model.assert_not_called()
            data = payload()
            data["responses"]["p1"] = {}
            result = self.client.post("/api/difficulty/evaluate-cached", json=data).json()
            self.assertIn("moon_position", result["missing"])
            self.assertIsNone(result["seeingArcsec"])
            model.assert_not_called()

    def test_zero_aod_and_full_moon_are_not_replaced_by_defaults(self):
        config = build_environment_config({"aod": 0, "moonPhaseAngle": 0, "moonCloudTransmission": 0})
        self.assertEqual(config.aod, 0)
        self.assertEqual(config.moon_phase_angle_deg, 0)
        self.assertEqual(config.moon_cloud_transmission, 0)

    def test_free_weather_uses_matching_native_moon_without_inventing_seeing(self):
        data = payload()
        data["responses"]["p1"] = {}
        data["astronomy"] = {"source": "stellarium", "datetime": data["datetime"], "location": data["location"],
                             "altitude": -10, "azimuth": 250, "phaseAngle": 0}
        with patch("app.api.endpoints.difficulty.fetch_black_marble_dem_sqm", return_value={"sqm": 20.5, "source": "black-marble-dem"}) as model:
            result = self.client.post("/api/difficulty/evaluate-cached", json=data)
            self.assertEqual(result.status_code, 200)
            self.assertIsNone(result.json()["seeingArcsec"])
            self.assertEqual(result.json()["source"], "black-marble-dem")
            self.assertEqual(model.call_args.args[2]["moonZenith"], 100)
            self.assertEqual(model.call_args.args[2]["moonPhaseAngle"], 0)
            data["astronomy"]["datetime"] = "2026-10-06T10:30:00Z"
            self.assertEqual(self.client.post("/api/difficulty/evaluate-cached", json=data).status_code, 422)

    def test_invalid_location_datetime_and_key_fields_are_rejected(self):
        for field, value in (("datetime", "bad"), ("location", {"latitude": 100, "longitude": 0}), ("apiKey", "secret")):
            data = payload()
            data[field] = value
            self.assertEqual(self.client.post("/api/difficulty/evaluate-cached", json=data).status_code, 422)


if __name__ == "__main__":
    unittest.main()
