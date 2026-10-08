import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.endpoints import assets
from app.services.automatic_terrain import TerrainPreparation
from app.services import annual_black_marble as annual


class AutomaticTerrainTests(unittest.TestCase):
    def test_saved_region_does_not_download_or_start_worker(self):
        manager = TerrainPreparation()
        with patch('app.services.automatic_terrain.cached_region', return_value={'dem': 'saved'}), \
             patch('app.services.automatic_terrain.prepare_region') as prepare:
            self.assertEqual(manager.request(37.5, 127, start=True)['state'], 'ready')
            prepare.assert_not_called()

    def test_location_changes_do_not_queue_or_duplicate_downloads_and_restart_reuses_files(self):
        manager = TerrainPreparation()
        entered, finish = threading.Event(), threading.Event()
        with tempfile.TemporaryDirectory() as folder:
            dem = Path(folder) / 'terrain.tif'
            def prepare(lat, lon, **kwargs):
                self.assertTrue(kwargs['terrain_only'])
                self.assertNotIn('token', kwargs)
                entered.set()
                finish.wait(5)
                dem.touch()
                return {'dem': str(dem), 'bounds': (126, 37, 128, 39)}
            with patch('app.services.automatic_terrain.cached_region', return_value=None), \
                 patch('app.services.automatic_terrain.cached_annual_tiles', return_value={'year': 2025}), \
                 patch('app.services.automatic_terrain.prepare_region', side_effect=prepare) as download:
                self.assertEqual(manager.request(37.5, 127, start=True)['state'], 'running')
                self.assertTrue(entered.wait(3))
                self.assertEqual(manager.request(37.5, 127, start=True)['state'], 'running')
                self.assertEqual(manager.request(33.4, 126.5, start=True)['state'], 'waiting')
                self.assertEqual(manager.request(0, 0, start=True)['state'], 'waiting')
                self.assertEqual(len(manager.jobs), 1)
                finish.set()
                deadline = time.monotonic() + 3
                while manager.active is not None and time.monotonic() < deadline:
                    time.sleep(.01)
                ready = manager.request(37.5, 127, start=True)
                self.assertEqual(ready['state'], 'ready')
                self.assertNotIn('path', ready)
                self.assertEqual(download.call_count, 1)
            # A new process uses the persisted region, rather than an in-memory job.
            with patch('app.services.automatic_terrain.cached_region', return_value={'dem': str(dem)}), \
                 patch('app.services.automatic_terrain.prepare_region') as download:
                self.assertEqual(TerrainPreparation().request(37.5, 127, start=True)['state'], 'ready')
                download.assert_not_called()

    def test_public_web_cannot_trigger_disk_downloads_and_invalid_locations_are_rejected(self):
        app = FastAPI()
        app.include_router(assets.router)
        client = TestClient(app)
        with patch.dict(os.environ, {'JMGJ_DESKTOP_TOKEN': ''}), patch.object(assets.TERRAIN, 'request') as prepare:
            self.assertEqual(client.post('/terrain', json={'latitude': 37.5, 'longitude': 127}).status_code, 404)
            prepare.assert_not_called()
        with patch.dict(os.environ, {'JMGJ_DESKTOP_TOKEN': 'a' * 64}):
            self.assertEqual(client.post('/terrain', json={'latitude': 91, 'longitude': 0}).status_code, 422)
            result = client.post('/terrain', json={'latitude': 90, 'longitude': 0}).json()
            self.assertEqual(result['state'], 'error')

    def test_bundled_black_marble_works_with_empty_user_folder_and_no_nasa_requests(self):
        import json
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            bundled = root / 'installed'
            (bundled / 'compact').mkdir(parents=True)
            name = 'VJ146A4.A2025001.h30v05.002.2026072000000.h5'
            (bundled / 'compact' / name).write_bytes(b'verified test fixture')
            (bundled / 'index.json').write_text(json.dumps({'product': 'VJ146A4', 'year': 2025,
                'tiles': {'h30v05': {'file': name, 'compactBytes': 21}}}))
            with patch.object(annual, 'world_root', return_value=root / 'empty-user-folder'), \
                 patch.object(annual, 'setting', return_value=str(bundled)), patch.object(annual.requests, 'get') as request:
                result = annual.cached_annual_tiles((126, 37, 127, 38))
                self.assertEqual(result['year'], 2025)
                self.assertTrue(result['blackMarble'][0].startswith(str(bundled)))
                request.assert_not_called()
                self.assertIsNone(annual.cached_annual_tiles((129.9, 37, 130.1, 38)))
