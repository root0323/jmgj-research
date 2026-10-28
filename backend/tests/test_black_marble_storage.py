from pathlib import Path
import tempfile
import unittest

import h5py
import numpy as np

from app.services.black_marble_storage import (
    FIELD, FIELDS, FORMAT, compact_black_marble, file_sha256, verify_compact,
)
from app.services.sky_brightness_model.core.data_loader import load_pixel_data_from_h5


class BlackMarbleStorageTests(unittest.TestCase):
    def make_source(self, path, *, version_one=False):
        with h5py.File(path, "w") as handle:
            handle.attrs["ShortName"] = "VJ146A4"
            handle.attrs["VersionID"] = "002"
            group = handle.create_group(FIELD)
            group["lat"] = np.array([37.6, 37.5, 37.4], dtype="float64")
            group["lon"] = np.array([126.9, 127, 127.1, 127.2], dtype="float64")
            group["lat"].attrs["units"] = "degrees_north"
            if version_one:
                raw = np.array([[100, 65535, 200, 0], [300, 400, 500, 600], [700, 800, 900, 1000]], dtype="uint16")
                scale, fill = .1, 65535
            else:
                # Distinct NaN payloads and negative zero must survive bit for bit.
                raw = np.array([[1, -999.9, 2, 0], [3, 4, 5, 6], [7, 8, 9, -0.0]], dtype="float32")
                raw.view("uint32")[2, 0:2] = [0x7fc00001, 0x7fc00002]
                scale, fill = 1., np.float32(-999.9)
            radiance = group.create_dataset(FIELDS[0], data=raw)
            radiance.attrs.update(scale_factor=scale, offset=0., _FillValue=fill, units="nWatts/(cm^2 sr)")
            quality = np.zeros(raw.shape, dtype="uint8")
            quality[0, 1], quality[1, 0], quality[1, 1] = 255, 1, 2
            group[FIELDS[1]] = quality
            group[FIELDS[1]].attrs["Description"] = "0=good;1=poor;2=gap;255=fill"
            group["AllAngle_Composite_Snow_Free_Std"] = np.ones(raw.shape)

    def test_float_bits_metadata_and_app_reader_survive(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "source.h5", Path(folder) / "subset.h5"
            self.make_source(source)
            original_hash = file_sha256(source)
            report = compact_black_marble(source, output)
            self.assertEqual(original_hash, file_sha256(source))
            self.assertEqual(report["sourceSha256"], original_hash)
            self.assertTrue(report["allRetainedValuesBitwiseEqual"])
            with h5py.File(output, "r") as handle:
                self.assertEqual(set(handle[FIELD]), set(FIELDS))
                self.assertEqual(handle.attrs["jmgj_format"], FORMAT)
                self.assertEqual(handle[FIELD + FIELDS[0]].shape, (3, 4))
                self.assertEqual(handle[FIELD + FIELDS[0]].compression, "gzip")
            before = load_pixel_data_from_h5(str(source), (37.5, 127), 30)
            self.assertTrue(before)
            self.assertEqual(before, load_pixel_data_from_h5(str(output), (37.5, 127), 30))

    def test_integer_scale_and_quality_mask_survive(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "source.h5", Path(folder) / "subset.h5"
            self.make_source(source, version_one=True)
            compact_black_marble(source, output)
            before = load_pixel_data_from_h5(str(source), (37.5, 127), 30)
            self.assertEqual(before, load_pixel_data_from_h5(str(output), (37.5, 127), 30))
            self.assertNotIn(6553.5, [pixel["radiance"] for pixel in before])
            self.assertNotIn((37.5, 126.9), [pixel["coord"] for pixel in before])

    def test_existing_output_and_source_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "source.h5", Path(folder) / "subset.h5"
            self.make_source(source)
            original_hash = file_sha256(source)
            output.write_bytes(b"existing")
            for destination in (source, output):
                with self.assertRaises(FileExistsError):
                    compact_black_marble(source, destination)
            self.assertEqual(file_sha256(source), original_hash)
            self.assertEqual(output.read_bytes(), b"existing")

    def test_bad_grid_is_rejected_without_partial_output(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "source.h5", Path(folder) / "subset.h5"
            self.make_source(source)
            with h5py.File(source, "r+") as handle:
                del handle[FIELD + "lat"]
                handle[FIELD + "lat"] = [37.5]
            with self.assertRaises(ValueError):
                compact_black_marble(source, output)
            self.assertFalse(output.exists())
            self.assertFalse(list(Path(folder).glob("*.part")))

    def test_verification_detects_changed_data_and_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / "source.h5", Path(folder) / "subset.h5"
            self.make_source(source)
            compact_black_marble(source, output)
            with h5py.File(output, "r+") as handle:
                handle[FIELD + FIELDS[0]][0, 0] = 99
            with self.assertRaisesRegex(ValueError, "Pixel bits changed"):
                verify_compact(source, output)
            with h5py.File(output, "r+") as handle:
                handle[FIELD + FIELDS[0]][0, 0] = 1
                handle[FIELD + FIELDS[0]].attrs["scale_factor"] = 2.
            with self.assertRaisesRegex(ValueError, "Field metadata changed"):
                verify_compact(source, output)
