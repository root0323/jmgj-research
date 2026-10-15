import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests

from app.services import cloud_black_marble as cloud
from app.services import annual_black_marble as annual
from app.services.geospatial_assets import AssetError
from test_annual_black_marble import make_raw


class CloudBlackMarbleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.h5'
        make_raw(self.source, 'h30v05')
        self.bytes = self.source.read_bytes()
        self.catalogue = self.root / 'catalogue.json'
        tiles = {f'h{h:02d}v{v:02d}': {
            'file': f'VJ146A4.A2025001.h{h:02d}v{v:02d}.002.2026072000000.h5',
            'compactBytes': len(self.bytes), 'compactSha256': cloud.file_sha256(self.source)}
            for h in range(36) for v in range(1, 16)}
        self.catalogue.write_text(json.dumps({'product': 'VJ146A4', 'version': 2, 'year': 2025, 'tiles': tiles}))
        self.cache = self.root / 'cache'
        settings = lambda key, default='': str(self.catalogue) if key == 'BLACK_MARBLE_CATALOG_FILE' else default
        for context in (patch.object(cloud, 'world_root', return_value=self.cache),
                        patch.object(annual, 'world_root', return_value=self.cache),
                        patch.object(annual, 'setting', return_value=''),
                        patch.object(cloud, 'setting', side_effect=settings)):
            context.start()
            self.addCleanup(context.stop)
        self.response = Mock(status_code=200)
        self.response.__enter__ = Mock(return_value=self.response)
        self.response.__exit__ = Mock(return_value=False)
        self.response.iter_content.side_effect = lambda _: iter([self.bytes])

    def test_only_observer_tiles_download_and_restart_is_offline(self):
        with patch.object(cloud.requests, 'get', return_value=self.response) as get:
            result = cloud.ensure_annual_tiles((126, 37, 127, 38))
            self.assertEqual(len(result['blackMarble']), 1)
            self.assertEqual(get.call_count, 1)
            self.assertIn('h30v05', get.call_args.args[0])
            self.assertNotIn('headers', get.call_args.kwargs)  # No NASA/API credential.
            self.assertFalse(get.call_args.kwargs['allow_redirects'])
            cloud.ensure_annual_tiles((126, 37, 127, 38))
            annual._verified_hash.cache_clear()  # Simulate a process restart.
            cloud.ensure_annual_tiles((126, 37, 127, 38))
            self.assertEqual(get.call_count, 1)
        self.assertEqual(len(list(self.cache.rglob('*.h5'))), 1)

    def test_boundary_requires_neighbor_tile_and_reuses_previous_tile(self):
        with patch.object(cloud.requests, 'get', return_value=self.response) as get:
            cloud.ensure_annual_tiles((126, 37, 127, 38))
            result = cloud.ensure_annual_tiles((129.9, 37, 130.1, 38))
            self.assertEqual(len(result['blackMarble']), 2)
            self.assertEqual(get.call_count, 2)

    def test_bad_hash_truncation_oversize_and_redirect_publish_nothing(self):
        for status, content in ((200, b'wrong'), (200, b'x' * len(self.bytes)),
                                (200, self.bytes + b'extra'), (302, self.bytes), (404, b'')):
            self.response.status_code = status
            self.response.iter_content.side_effect = lambda _, b=content: iter([b])
            with patch.object(cloud.requests, 'get', return_value=self.response):
                with self.assertRaises(AssetError):
                    cloud.ensure_annual_tiles((126, 37, 127, 38))
            self.assertFalse((self.cache / 'index.json').exists())
            self.assertEqual(list(self.cache.rglob('*.h5')), [])
            self.assertEqual(list(self.cache.rglob('*.part')), [])

    def test_network_error_preserves_saved_neighbor_and_retry_completes(self):
        with patch.object(cloud.requests, 'get', return_value=self.response):
            cloud.ensure_annual_tiles((126, 37, 127, 38))
        saved = next(self.cache.rglob('*.h5'))
        before = saved.read_bytes()
        with patch.object(cloud.requests, 'get', side_effect=requests.ConnectionError('private provider detail')):
            with self.assertRaises(AssetError) as error:
                cloud.ensure_annual_tiles((129.9, 37, 130.1, 38))
            self.assertNotIn('private provider', str(error.exception))
        self.assertEqual(saved.read_bytes(), before)
        with patch.object(cloud.requests, 'get', return_value=self.response):
            self.assertEqual(len(cloud.ensure_annual_tiles((129.9, 37, 130.1, 38))['blackMarble']), 2)

    def test_same_size_corruption_is_repaired_and_unindexed_completed_file_recovers(self):
        with patch.object(cloud.requests, 'get', return_value=self.response) as get:
            cloud.ensure_annual_tiles((126, 37, 127, 38))
            file = next(self.cache.rglob('*.h5'))
            file.write_bytes(b'x' * len(self.bytes))
            cloud.ensure_annual_tiles((126, 37, 127, 38))
            self.assertEqual(get.call_count, 2)
            self.assertEqual(file.read_bytes(), self.bytes)
            (self.cache / 'index.json').unlink()
            cloud.ensure_annual_tiles((126, 37, 127, 38))
            self.assertEqual(get.call_count, 2)

    def test_catalogue_rejects_path_escape_wrong_release_size_and_missing_tile(self):
        original = json.loads(self.catalogue.read_text())
        for mutate in (lambda d: d.update(year=2024), lambda d: d['tiles'].pop('h00v01'),
                       lambda d: d['tiles']['h30v05'].update(file='../secret.h5'),
                       lambda d: d['tiles']['h30v05'].update(compactBytes=cloud.MAX_TILE_BYTES + 1),
                       lambda d: d['tiles']['h30v05'].update(compactSha256='not a hash')):
            data = json.loads(json.dumps(original))
            mutate(data)
            self.catalogue.write_text(json.dumps(data))
            with patch.object(cloud.requests, 'get') as get:
                with self.assertRaises(AssetError): cloud.ensure_annual_tiles((126, 37, 127, 38))
                get.assert_not_called()

    def test_only_fixed_https_release_host_is_accepted(self):
        for url in ('http://127.0.0.1/', 'https://evil.example/VJ146A4-2025',
                    cloud.BASE_URL + '?token=private', cloud.BASE_URL.replace('https://', 'https://user:pw@')):
            with patch.object(cloud, 'setting', return_value=url):
                with self.assertRaises(AssetError): cloud._base_url()


if __name__ == '__main__':
    unittest.main()
