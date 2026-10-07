import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from http.server import ThreadingHTTPServer

import h5py
import numpy as np
import requests

from app.scripts import download_black_marble as screen
from app.services import annual_black_marble as annual
from app.services.geospatial_assets import AssetError, FIELD


def records(size=100000):
    return [{"tile": f"h{h:02d}v{v:02d}",
             "name": f"VJ146A4.A2025001.h{h:02d}v{v:02d}.002.2026072000000.h5",
             "url": f"https://data.laadsdaac.earthdatacloud.nasa.gov/prod-lads/VJ146A4/VJ146A4.A2025001.h{h:02d}v{v:02d}.002.2026072000000.h5",
             "bytes": size} for h in range(36) for v in range(1,16)]


def make_raw(path, tile):
    path.parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(path, "w") as handle:
        handle.attrs.update(ShortName="VJ146A4", VersionID="002", RangeBeginningDate="2025-01-01",
                            HorizontalTileNumber=int(tile[1:3]), VerticalTileNumber=int(tile[4:6]))
        group = handle.create_group(FIELD)
        group["lat"], group["lon"] = [37.6,37.5,37.4], [126.9,127,127.1,127.2]
        group["AllAngle_Composite_Snow_Free"] = np.ones((3,4),dtype="float32")
        group["AllAngle_Composite_Snow_Free_Quality"] = np.zeros((3,4),dtype="uint8")


def make_world(root):
    prototype = root / "prototype.h5"
    make_raw(prototype, "h00v01")
    manifest = {"product":"VJ146A4","version":2,"year":2025,"records":records(prototype.stat().st_size)}
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return annual.WorldDownload(root)


class AnnualBlackMarbleTests(unittest.TestCase):
    def test_metadata_uses_exact_year_filename_and_all_unique_tiles(self):
        entries = [{"producer_granule_id":r["name"],"granule_size":r["bytes"]/1024**2,
                    "links":[{"href":r["url"]}]} for r in records()]
        response = Mock(headers={"CMR-Hits":"540"})
        response.json.return_value = {"feed":{"entry":entries}}
        with patch.object(annual.requests, "get", return_value=response) as get:
            result = annual.discover_world()
            self.assertEqual(len(result["records"]),540)
            self.assertNotIn("temporal",get.call_args.kwargs["params"])
            self.assertEqual(get.call_args.kwargs["params"]["producer_granule_id"],"VJ146A4.A2025001.*.002.*.h5")
            entries[-1] = entries[0]
            with self.assertRaises(AssetError): annual.discover_world()
            entries.pop()
            with self.assertRaises(AssetError): annual.discover_world()

    def test_manifest_rejects_credentials_foreign_hosts_and_paths(self):
        for name,url in (("../../secret.h5",None),(None,"https://external.example/file.h5"),
                         (None,records()[0]["url"]+"?token=secret")):
            record = records()[0]
            if name: record["name"] = name
            if url: record["url"] = url
            with self.assertRaises(AssetError): annual._check_record(record)

    def test_seed_preserves_original_and_publishes_only_covered_tiles(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            world = make_world(root)
            source_dir = root / "user-originals"
            record = next(r for r in world.manifest["records"] if r["tile"]=="h30v05")
            source = source_dir / record["name"]
            make_raw(source,record["tile"])
            before = annual.file_sha256(source)
            with patch.object(annual,"download",side_effect=AssertionError("unexpected download")):
                world.seed(source_dir)
            self.assertEqual(world.status()["completed"],1)
            self.assertEqual(annual.file_sha256(source),before)
            with patch.object(annual,"world_root",return_value=root):
                self.assertEqual(annual.cached_annual_tiles((126,37,127,38))["year"],2025)
                self.assertIsNone(annual.cached_annual_tiles((129.9,37,130.1,38)))
            raw,compact,report = world._paths(record)
            report.unlink()  # Simulate a crash after the H5 was published.
            world._process(record,"",lambda message:None)
            self.assertTrue(report.is_file())
            self.assertTrue(annual.verify_compact(raw,compact))

    def test_stop_resume_and_hash_check_do_not_redownload_completed_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            world = make_world(root)
            stopped = threading.Event()
            limit = [1]
            def progress(message):
                if world.status()["completed"] >= limit[0]: stopped.set()
            def fake_download(url,destination,token,**kwargs):
                self.assertEqual(token,"test-only-token")
                tile = annual.NAME.fullmatch(destination.name)[1]
                make_raw(destination,tile)
            with patch.object(annual,"download",side_effect=fake_download) as download:
                self.assertFalse(world.run("test-only-token",stopped,progress))
                self.assertEqual(download.call_count,1)
                stopped.clear();limit[0]=2
                resumed = annual.WorldDownload(root)
                world = resumed
                self.assertFalse(resumed.run("test-only-token",stopped,progress))
                self.assertEqual(download.call_count,2)
            raw,compact,_ = world._paths(world.manifest["records"][0])
            with compact.open("r+b") as stream:
                stream.seek(0);stream.write(b"corrupt!")
            with self.assertRaisesRegex(AssetError,"해시"):
                resumed._process(resumed.manifest["records"][0],"test-only-token",lambda message:None)

    def test_wrong_tile_in_h5_and_missing_token_stop_before_network(self):
        with tempfile.TemporaryDirectory() as folder:
            world = make_world(Path(folder))
            record = world.manifest["records"][0]
            with patch.object(annual,"download") as download:
                with self.assertRaises(AssetError): world._process(record,"",lambda message:None)
                download.assert_not_called()
            raw,_,_ = world._paths(record)
            make_raw(raw,"h01v01")
            with self.assertRaisesRegex(AssetError,"타일 번호"):
                world._process(record,"",lambda message:None)

    def test_screen_requires_origin_csrf_and_never_echoes_token(self):
        server = ThreadingHTTPServer(("127.0.0.1",0),screen.Handler)
        port = server.server_address[1]
        origin = f"http://127.0.0.1:{port}"
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with patch.object(screen,"PORT",port),patch.object(screen,"ORIGIN",origin), \
                 patch.object(screen,"JOB",{"running":False,"phase":"ready","message":"ready"}), \
                 patch.object(screen,"run_job") as worker:
                data = {"token":"test-only-token"}
                for headers in ({},{"Origin":"https://external.example","X-Download-CSRF":screen.CSRF}):
                    response = requests.post(origin+"/start",json=data,headers=headers,timeout=5)
                    self.assertEqual(response.status_code,403)
                worker.assert_not_called()
                headers = {"Origin":origin,"X-Download-CSRF":screen.CSRF}
                response = requests.post(origin+"/start",json=data,headers=headers,timeout=5)
                self.assertEqual(response.status_code,202)
                self.assertNotIn(data["token"],response.text)
                self.assertEqual(requests.post(origin+"/start",json=data,headers=headers,timeout=5).status_code,409)
                self.assertEqual(requests.post(origin+"/stop",json={},headers=headers,timeout=5).status_code,202)
        finally:
            server.shutdown();server.server_close()

    def test_worker_exception_does_not_expose_token(self):
        data = {"token":"test-only-token"}
        world = Mock()
        world.run.side_effect = RuntimeError("failed: test-only-token")
        with patch.object(screen,"WORLD",world):
            screen.run_job(data)
        self.assertFalse(data)
        self.assertNotIn("test-only-token",json.dumps(screen.JOB))
