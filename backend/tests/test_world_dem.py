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
from app.services import dem_storage as storage


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
            self.assertEqual(world.status()['optimized'],8)
            with patch.object(dem,'world_dem_root',return_value=world.root):
                for name,source in sources.items():
                    with rasterio.open(source) as original,rasterio.open(dem.cached_dem_tile(name)) as result:
                        self.assertTrue(np.array_equal(original.read().view('uint32'),result.read().view('uint32')))
                    self.assertFalse((world.root/'tiles'/(name+'.tif')).exists())

    def test_legacy_raw_tiles_migrate_without_download_and_reduce_actual_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            world,sources=make_world(root)
            record=world.records[0]
            source=sources[record['name']]
            original_bytes=source.read_bytes()
            raw=world.root/'tiles'/source.name
            raw.parent.mkdir()
            shutil.copyfile(source,raw)
            with closing(sqlite3.connect(world.database)) as database:
                database.execute('INSERT INTO tiles VALUES (?,?,?,?,?)',(record['name'],record['bytes'],record['etag'],storage.file_hash(source),'before'))
                database.commit()
                database.execute('DROP TABLE storage')
                database.commit()
            world=dem.WorldDEM(world.root)
            with patch.object(dem,'download',side_effect=AssertionError('redownload')):
                self.assertTrue(world.run(threading.Event()))
                self.assertTrue(world.run(threading.Event()))
            state=world.status()
            self.assertEqual(state['optimized'],1)
            self.assertGreater(state['savedBytes'],0)
            self.assertEqual(state['completedSourceBytes'],record['bytes'])
            self.assertEqual(state['completedBytes']+state['savedBytes'],record['bytes'])
            self.assertFalse(raw.exists())
            compact=world.root/'compact'/source.name
            self.assertEqual(compact.stat().st_size,state['completedBytes'])
            self.assertEqual(source.read_bytes(),original_bytes)

    def test_failed_conversion_keeps_owned_raw_and_ready_index(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            world,sources=make_world(root)
            record=world.records[0]
            raw=world.root/'tiles'/(record['name']+'.tif')
            raw.parent.mkdir()
            shutil.copyfile(sources[record['name']],raw)
            with closing(sqlite3.connect(world.database)) as database:
                database.execute('INSERT INTO tiles VALUES (?,?,?,?,?)',(record['name'],record['bytes'],record['etag'],storage.file_hash(raw),'before'))
                database.commit()
                with patch.object(dem,'pack_tile',side_effect=dem.AssetError('conversion failed')):
                    with self.assertRaisesRegex(dem.AssetError,'conversion failed'):
                        world._process(record,database,lambda message:None)
            self.assertEqual(world.status()['optimized'],0)
            self.assertEqual(raw.read_bytes(),sources[record['name']].read_bytes())
            with patch.object(dem,'world_dem_root',return_value=world.root):
                self.assertEqual(dem.cached_dem_tile(record['name']),raw)

    def test_cleanup_interruption_resumes_from_registered_compact_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            world,sources=make_world(root)
            record=world.records[0]
            raw=world.root/'tiles'/(record['name']+'.tif')
            raw.parent.mkdir()
            shutil.copyfile(sources[record['name']],raw)
            unlink=Path.unlink
            def interrupted(path,*args,**kwargs):
                if path==raw:raise PermissionError('interrupted after commit')
                return unlink(path,*args,**kwargs)
            with closing(sqlite3.connect(world.database)) as database,patch.object(Path,'unlink',interrupted):
                with self.assertRaises(PermissionError):world._process(record,database,lambda message:None)
            self.assertTrue(raw.exists())
            self.assertEqual(world.status()['optimized'],1)
            with patch.object(dem,'world_dem_root',return_value=world.root):
                self.assertEqual(dem.cached_dem_tile(record['name']).parent.name,'compact')
            with patch.object(dem,'download',side_effect=AssertionError('redownload')):
                self.assertTrue(world.run(threading.Event()))
            self.assertFalse(raw.exists())

    def test_corrupt_compact_file_is_rejected_on_resume(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            world,sources=make_world(root)
            with patch.object(dem,'download',side_effect=lambda url,path,**kwargs:shutil.copyfile(sources[Path(url).stem],path)),patch.object(dem,'asset_root',return_value=root/'empty'):
                self.assertTrue(world.run(threading.Event()))
            compact=next((world.root/'compact').glob('*.tif'))
            data=bytearray(compact.read_bytes());data[-1]^=1;compact.write_bytes(data)
            with self.assertRaisesRegex(dem.AssetError,'해시'):
                world.run(threading.Event())

    def test_lossless_high_latitude_float_bits_masks_and_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            name=dem.dem_tile(80,12)
            raw=root/'high-latitude.tif'
            values=np.random.default_rng(23).uniform(-10,2000,(1,1200,240)).astype('float32')
            values[0,0,:3]=[-0.0,0.0,-9999]
            with rasterio.open(raw,'w',driver='GTiff',width=240,height=1200,count=1,
                               dtype='float32',crs='EPSG:4326',transform=from_origin(12,81,1/240,1/1200),nodata=-9999) as output:
                output.write(values)
                output.update_tags(AREA_OR_POINT='Point',TIFFTAG_COPYRIGHT='test credit')
                output.update_tags(1,description='native elevation')
                output.units=('m',);output.scales=(1.0,);output.offsets=(0.0,)
            record=dict(name=name,bytes=raw.stat().st_size,etag=hashlib.md5(raw.read_bytes(),usedforsecurity=False).hexdigest())
            sha=dem.verify_tile(raw,record)
            candidate=root/'packed.tif'
            format_name,size,stored_sha,digest=storage.pack_tile(raw,candidate,record,sha)
            self.assertEqual(format_name,storage.PACKED)
            storage.verify_storage(candidate,record,(format_name,size,stored_sha,sha,digest),dem.verify_tile)
            self.assertEqual(storage.file_hash(raw),sha)
            with rasterio.open(candidate) as result:
                self.assertTrue(np.array_equal(result.read().view('uint32'),values.view('uint32')))
                self.assertEqual(result.read_masks()[0,0,2],0)
                self.assertEqual(result.transform.a,1/240)
                self.assertEqual(result.tags()['TIFFTAG_COPYRIGHT'],'test credit')
                self.assertEqual(result.units,('m',))
                self.assertFalse(result.overviews(1))

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
