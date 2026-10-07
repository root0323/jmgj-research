import json
from pathlib import Path
import tempfile
import unittest
import threading
from unittest.mock import patch, Mock

import h5py
import numpy as np

from app import local_config
from app.services import geospatial_assets as assets
from app.services.sky_brightness_model.core.data_loader import load_pixel_data_from_h5
from app.scripts import local_setup
from http.server import ThreadingHTTPServer
import requests


class GeospatialTests(unittest.TestCase):
    def test_local_setup_requires_origin_csrf_and_does_not_echo_keys(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), local_setup.Handler)
        port = server.server_address[1]
        origin = f"http://127.0.0.1:{port}"
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with patch.object(local_setup, "PORT", port), patch.object(local_setup, "ORIGIN", origin), \
                 patch.object(local_setup, "save_settings") as save:
                data = {"KAKAO_REST_API_KEY": "test-only-placeholder"}
                for headers in ({}, {"Origin": "https://external.example", "X-Setup-CSRF": local_setup.CSRF}):
                    self.assertEqual(requests.post(origin + "/keys", json=data, headers=headers, timeout=5).status_code, 403)
                save.assert_not_called()
                response = requests.post(origin + "/keys", json=data, headers={"Origin": origin, "X-Setup-CSRF": local_setup.CSRF}, timeout=5)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn(data["KAKAO_REST_API_KEY"], response.text)
                save.assert_called_once_with(data)
        finally:
            server.shutdown()
            server.server_close()

    def test_tile_boundaries_cover_hemispheres_and_adjacent_light_tiles(self):
        self.assertIn("S01_00_W001_00", assets.dem_tile(-1, -1))
        self.assertEqual(assets.light_tiles((126, 37, 127, 38)), ["h30v05"])
        self.assertEqual(assets.light_tiles((129.9, 37, 130.1, 38)), ["h30v05", "h31v05"])
        for coords in ((0, 179.99), (90, 0), (float("nan"), 0)):
            with self.assertRaises(ValueError):
                assets.region_bounds(*coords)

    def test_manifest_only_matches_covered_location_and_complete_files(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(assets, "asset_root", return_value=Path(folder)):
            root = Path(folder)
            (root / "regions").mkdir()
            (root / "dem.tif").touch()
            data = {"bounds": [126, 37, 128, 39], "dem": str(root / "dem.tif"), "blackMarble": [str(root / "light.h5")], "month": "2026-08"}
            (root / "regions" / "test.json").write_text(json.dumps(data))
            self.assertIsNone(assets.cached_region(37.5, 127))
            (root / "light.h5").touch()
            self.assertIsNotNone(assets.cached_region(37.5, 127))
            self.assertIsNone(assets.cached_region(33.4, 126.5))

    def test_fill_and_quality_mask_apply_before_scale_and_only_nearby_pixels_load(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.h5"
            with h5py.File(path, "w") as file:
                group = file.create_group(assets.FIELD)
                group["lat"] = [38, 37.5, 37.4, 37.3, 33]
                group["lon"] = [126, 127, 128]
                raw = np.zeros((5, 3), dtype="uint16")
                raw[1, 1], raw[2, 1], raw[3, 1] = 65535, 100, 200
                radiance = group.create_dataset("AllAngle_Composite_Snow_Free", data=raw)
                radiance.attrs.update(scale_factor=.1, _FillValue=65535)
                quality = np.zeros_like(raw)
                quality[3, 1] = 1
                group["AllAngle_Composite_Snow_Free_Quality"] = quality
            pixels = load_pixel_data_from_h5(str(path), (37.4, 127), 30)
            self.assertEqual(len(pixels), 1)
            self.assertEqual(pixels[0]["radiance"], 10)
            self.assertEqual(pixels[0]["coord"], (37.4, 127))

    def test_redirect_never_sends_nasa_token_to_s3(self):
        redirect = Mock(status_code=302, is_redirect=True, headers={"Location": "https://example.s3.amazonaws.com/object?signature=test"})
        final = Mock(status_code=200, is_redirect=False)
        final.iter_content.return_value = [b"123456789"]
        for response in (redirect, final):
            response.__enter__ = Mock(return_value=response)
            response.__exit__ = Mock(return_value=False)
        with tempfile.TemporaryDirectory() as folder, patch.object(assets.requests, "get", side_effect=[redirect, final]) as get:
            assets.download("https://data.laadsdaac.earthdatacloud.nasa.gov/file.h5", Path(folder) / "file.h5", "test-token")
            self.assertEqual(get.call_args_list[0].kwargs["headers"]["Authorization"], "Bearer test-token")
            self.assertEqual(get.call_args_list[1].kwargs["headers"], {})

    def test_settings_reload_and_environment_priority(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(local_config, "ENV_PATH", Path(folder) / ".env"), patch.dict(local_config.os.environ, {}, clear=True):
            local_config.save_settings({"KAKAO_REST_API_KEY": "first"})
            self.assertEqual(local_config.setting("KAKAO_REST_API_KEY"), "first")
            local_config.save_settings({"KAKAO_REST_API_KEY": "second"})
            self.assertEqual(local_config.setting("KAKAO_REST_API_KEY"), "second")
            with patch.dict(local_config.os.environ, {"KAKAO_REST_API_KEY": "deployment"}):
                self.assertEqual(local_config.setting("KAKAO_REST_API_KEY"), "deployment")
            with self.assertRaises(ValueError):
                local_config.save_settings({"KAKAO_REST_API_KEY": "a\nOTHER=bad"})
