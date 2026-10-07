import hashlib
from contextlib import closing
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

import numpy as np
import rasterio
from rasterio.transform import from_origin
import requests

from app.scripts import download_world_dem as screen
from app.services import world_dem as dem


def raw_tile(path, name, height=1200):
    lat, lon = dem._coordinates(name)
    with rasterio.open(path, "w", driver="GTiff", count=1, width=1200, height=height,
                       dtype="float32", crs="EPSG:4326", transform=from_origin(lon,lat+1,1/1200,1/1200),
                       compress="deflate", nodata=-9999) as output:
        output.write(np.full((1,height,1200),100,dtype="float32"))
    data=path.read_bytes()
    return {"name":name,"bytes":len(data),"etag":hashlib.md5(data,usedforsecurity=False).hexdigest()}


def make_world(root, count=1):
    records=[]
    for lon in range(6,6+count):
        name=dem.dem_tile(0,lon)
        records.append(raw_tile(root/(name+'.tif'),name))
    manifest={"product":dem.PRODUCT,"source":dem.DEM_BASE,"records":records}
    return dem.WorldDEM(root/"world",manifest), {r["name"]:root/(r["name"]+'.tif') for r in records}


class WorldDEMTests(unittest.TestCase):
    def test_records_reject_paths_wrong_product_and_invalid_coordinates(self):
        for name in ("../../file","Copernicus_DSM_COG_10_N00_00_E006_00_DEM",
                     "Copernicus_DSM_COG_30_N90_00_E006_00_DEM"):
            with self.assertRaises(dem.AssetError):
                dem.validate_record({"name":name,"bytes":100,"etag":"a"*32})

    def test_native_grid_and_etag_must_match_before_indexing(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            name=dem.dem_tile(0,6)
            path=root/'source.tif'
            record=raw_tile(path,name)
            before=hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(dem.verify_tile(path,record),before)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),before)
            record['etag']='a'*32
            with self.assertRaisesRegex(dem.AssetError,'MD5'):dem.verify_tile(path,record)
            record=raw_tile(path,name,height=600)
            with self.assertRaisesRegex(dem.AssetError,'격자'):dem.verify_tile(path,record)

    def test_stop_resume_preserves_bytes_and_downloads_only_missing_tiles(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            world,sources=make_world(root,8)
            stopped=threading.Event()
            downloads=[]
            def get(url,path,**kwargs):
                name=Path(url).stem
                downloads.append(name)
                shutil.copyfile(sources[name],path)
                stopped.set()
            with patch.object(dem,'download',side_effect=get),patch.object(dem,'asset_root',return_value=root/'empty'):
                self.assertFalse(world.run(stopped))
            count=world.status()['completed']
            self.assertGreater(count,0)
            self.assertLessEqual(count,4)
            first=set(downloads)
            stopped.clear()
            def get_remaining(url,path,**kwargs):
                name=Path(url).stem
                self.assertNotIn(name,first)
                downloads.append(name)
                shutil.copyfile(sources[name],path)
            with patch.object(dem,'download',side_effect=get_remaining),patch.object(dem,'asset_root',return_value=root/'empty'):
                self.assertTrue(dem.WorldDEM(world.root).run(stopped))
            self.assertEqual(len(downloads),8)
            self.assertEqual(world.status()['completed'],8)
            for name,source in sources.items():
                self.assertEqual(source.read_bytes(),(world.root/'tiles'/(name+'.tif')).read_bytes())

    def test_bad_download_never_becomes_app_visible(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            world,_=make_world(root)
            def bad(url,path,**kwargs):path.write_bytes(b'not-a-raster')
            with closing(sqlite3.connect(world.database)) as database,patch.object(dem,'download',side_effect=bad),patch.object(dem,'asset_root',return_value=root/'empty'):
                with self.assertRaises(dem.AssetError):world._process(world.records[0],database,lambda message:None)
            self.assertEqual(world.status()['completed'],0)
            self.assertEqual(list((world.root/'tiles').glob('*')),[])

    def test_local_mosaic_uses_ready_tiles_without_network_or_missing_land_as_ocean(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            world,sources=make_world(root,2)
            def get(url,path,**kwargs):shutil.copyfile(sources[Path(url).stem],path)
            with closing(sqlite3.connect(world.database)) as database,patch.object(dem,'download',side_effect=get),patch.object(dem,'asset_root',return_value=root/'empty'):
                world._process(world.records[0],database,lambda message:None)
            with patch.object(dem,'world_dem_root',return_value=world.root),patch('requests.get',side_effect=AssertionError('network')):
                path=dem.cached_world_dem((6.2,.2,6.3,.3))
                self.assertIsNotNone(path)
                with rasterio.open(path) as source:
                    self.assertTrue(np.all(source.read(1)==100))
                self.assertIsNone(dem.cached_world_dem((6.95,.2,7.05,.3)))

    def test_screen_rejects_cross_origin_and_nonempty_start_payload(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),screen.Handler)
        port=server.server_address[1]
        origin=f'http://127.0.0.1:{port}'
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            with patch.object(screen,'PORT',port),patch.object(screen,'ORIGIN',origin),patch.object(screen,'start_job',return_value=True) as start:
                self.assertEqual(requests.post(origin+'/start',json={},timeout=5).status_code,403)
                headers={'Origin':origin,'X-Download-CSRF':screen.CSRF}
                self.assertEqual(requests.post(origin+'/start',json={'token':'not-accepted'},headers=headers,timeout=5).status_code,400)
                start.assert_not_called()
                self.assertEqual(requests.post(origin+'/start',json={},headers=headers,timeout=5).status_code,202)
                start.assert_called_once()
        finally:
            server.shutdown();server.server_close()
