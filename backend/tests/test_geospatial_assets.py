import json
from pathlib import Path
import tempfile
import unittest
import threading
from unittest.mock import patch, Mock

import h5py
import numpy as np
import rasterio
from rasterio.transform import from_origin

from app import local_config
from app.services import geospatial_assets as assets
from app.services.sky_brightness_model.core.data_loader import load_pixel_data_from_h5
from app.scripts import local_setup
from http.server import ThreadingHTTPServer
import requests


class GeospatialTests(unittest.TestCase):
    def test_point_grid_mosaics_cover_fractional_windows_without_false_nodata_edges(self):
        # Real-world failing extents: north/south tile seam, west/east seam,
        # southern hemisphere, and a high-latitude tile with wider columns.
        for latitude, longitude, width in ((38.119, 128.465, 1200),
                                           (-33.4489, -70.6693, 1200),
                                           (69.6492, 18.9553, 600)):
            with self.subTest(latitude=latitude), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                bounds = assets.region_bounds(latitude, longitude)
                aligned = assets.dem_mosaic_bounds(bounds)
                self.assertEqual(aligned, assets.dem_mosaic_bounds(aligned))
                import math
                paths = {}
                for lat in range(math.floor(aligned[1]), math.ceil(aligned[3])):
                    for lon in range(math.floor(aligned[0]), math.ceil(aligned[2])):
                        name = assets.dem_tile(lat, lon)
                        path = root / (name + '.tif')
                        with rasterio.open(path, 'w', driver='GTiff', count=1, width=width,
                                           height=1200, dtype='float32', crs='EPSG:4326',
                                           transform=from_origin(lon - 1/(2*width), lat+1+1/2400, 1/width, 1/1200),
                                           nodata=-9999, compress='deflate') as dst:
                            dst.write(np.full((1,1200,width), 100 + lat, dtype='float32'))
                        paths[name] = path
                before = {name: path.read_bytes() for name, path in paths.items()}
                with patch('app.services.world_dem.global_dem_names', return_value=set(paths)), \
                     patch('app.services.world_dem.cached_dem_tile', side_effect=paths.get), \
                     patch('requests.get', side_effect=AssertionError('network')):
                    output = assets.prepare_dem(bounds, root / 'region', allow_download=False)
                with rasterio.open(output) as src:
                    array = src.read(1, masked=True)
                    self.assertFalse(np.ma.getmaskarray(array).any())
                    self.assertTrue(set(np.unique(array)).issubset({100+int(name.split('_')[4][1:]) * (-1 if '_S' in name else 1) for name in paths}))
                    self.assertLessEqual(src.bounds.left, bounds[0])
                    self.assertLessEqual(src.bounds.bottom, bounds[1])
                    self.assertGreaterEqual(src.bounds.right + 1e-10, bounds[2])
                    self.assertGreaterEqual(src.bounds.top + 1e-10, bounds[3])
                self.assertEqual(before, {name: path.read_bytes() for name, path in paths.items()})

    def test_actual_dem_nodata_is_rejected_instead_of_filled(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'source.tif'
            with rasterio.open(path, 'w', driver='GTiff', count=1, width=1200, height=1200,
                               dtype='float32', crs='EPSG:4326',
                               transform=from_origin(6-1/2400, 1+1/2400, 1/1200, 1/1200), nodata=-9999) as dst:
                array = np.full((1,1200,1200),100,dtype='float32')
                array[0,600,600] = -9999
                dst.write(array)
            with patch('app.services.world_dem.global_dem_names', return_value={assets.dem_tile(0,6)}), \
                 patch('app.services.world_dem.cached_dem_tile', return_value=path):
                with self.assertRaises(assets.AssetError):
                    assets.prepare_dem((6.2,.2,6.8,.8), root / 'region', allow_download=False)

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
        with tempfile.TemporaryDirectory() as folder, patch.object(assets, "asset_root", return_value=Path(folder)), \
             patch("app.services.annual_black_marble.cached_annual_tiles", return_value=None):
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

    def test_redirect_never_sends_nasa_token_to_s3_or_verified_cdn(self):
        for host in ("example.s3.amazonaws.com", "d13j1jds5ybppo.cloudfront.net"):
            redirect = Mock(status_code=302, is_redirect=True, headers={"Location": f"https://{host}/object?signature=test"})
            final = Mock(status_code=200, is_redirect=False)
            final.iter_content.return_value = [b"123456789"]
            for response in (redirect, final):
                response.__enter__ = Mock(return_value=response)
                response.__exit__ = Mock(return_value=False)
            with tempfile.TemporaryDirectory() as folder, patch.object(assets.requests, "get", side_effect=[redirect, final]) as get:
                output = Path(folder) / "file.h5"
                assets.download("https://data.laadsdaac.earthdatacloud.nasa.gov/file.h5", output, "test-token")
                self.assertEqual(get.call_args_list[0].kwargs["headers"]["Authorization"], "Bearer test-token")
                self.assertEqual(get.call_args_list[1].kwargs["headers"], {})
                self.assertEqual(output.read_bytes(), b"123456789")

    def test_blocked_redirect_reports_only_host_without_credentials(self):
        for target in ("https://unsupported.example/private/test-token?signature=private-signature",
                       "https://unverified.cloudfront.net/private?signature=private-signature",
                       "http://example.s3.amazonaws.com/private?signature=private-signature"):
            redirect = Mock(status_code=302, is_redirect=True, headers={"Location": target})
            redirect.__enter__ = Mock(return_value=redirect)
            redirect.__exit__ = Mock(return_value=False)
            with tempfile.TemporaryDirectory() as folder, patch.object(assets.requests, "get", return_value=redirect) as get:
                with self.assertRaises(assets.AssetError) as error:
                    assets.download("https://data.laadsdaac.earthdatacloud.nasa.gov/file.h5", Path(folder) / "file.h5", "test-token")
                self.assertNotIn("test-token", str(error.exception))
                self.assertNotIn("private", str(error.exception))
                self.assertEqual(get.call_count, 1)
                self.assertFalse((Path(folder) / "file.h5").exists())

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
