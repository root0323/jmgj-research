"""Lossless, native-resolution Black Marble subsets for the research app.

These are app HDF5 files, not complete NASA HDF-EOS products. Keep the source
separately for research that needs the discarded snow/angle/statistics layers.
"""
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import tempfile

import h5py
import numpy as np

from app.services.geospatial_assets import FIELD
from app.services.sky_brightness_model.core.data_loader import (
    BLACK_MARBLE_QUALITY_SDS,
    BLACK_MARBLE_RADIANCE_SDS,
)

FIELDS = (BLACK_MARBLE_RADIANCE_SDS, BLACK_MARBLE_QUALITY_SDS, "lat", "lon")
FORMAT = "jmgj-black-marble-subset-v1"
BLOCK_ROWS = 128


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _selections(dataset):
    for start in range(0, dataset.shape[0], BLOCK_ROWS):
        yield (slice(start, min(start + BLOCK_ROWS, dataset.shape[0])),) + (
            slice(None),
        ) * (dataset.ndim - 1)


def _validate_fields(handle):
    fields = {}
    for name in FIELDS:
        dataset = handle.get(FIELD + name)
        if not isinstance(dataset, h5py.Dataset) or dataset.dtype.kind not in "fiu":
            raise ValueError(f"Missing or nonnumeric Black Marble field: {name}")
        fields[name] = dataset
    shape = fields[BLACK_MARBLE_RADIANCE_SDS].shape
    if len(shape) != 2 or not all(shape) or fields[BLACK_MARBLE_QUALITY_SDS].shape != shape:
        raise ValueError("Radiance and quality must share a nonempty 2D grid.")
    coordinate_shapes = (fields["lat"].shape, fields["lon"].shape)
    if coordinate_shapes not in (((shape[0],), (shape[1],)), (shape, shape)):
        raise ValueError("Coordinates do not match the radiance grid.")
    return fields


def _copy_attributes(source, destination):
    for name in source:
        dtype = source.get_id(name).dtype
        if h5py.check_dtype(ref=dtype) is not None:
            raise ValueError(f"Cannot retain an HDF5 reference attribute: {name}")
        destination.create(name, source[name], dtype=dtype)


def _same_attributes(source, destination):
    for name in source:
        if name not in destination or source.get_id(name).dtype != destination.get_id(name).dtype:
            return False
        left, right = np.asarray(source[name]), np.asarray(destination[name])
        if not np.array_equal(left, right, equal_nan=left.dtype.kind in "fc"):
            return False
    return True


def verify_compact(source: Path, compact: Path) -> dict:
    """Compare every retained element, including float bit patterns and fill values."""
    result = {}
    with h5py.File(source, "r") as original, h5py.File(compact, "r") as subset:
        source_fields, compact_fields = _validate_fields(original), _validate_fields(subset)
        if not _same_attributes(original.attrs, subset.attrs):
            raise ValueError("Source metadata was changed during conversion.")
        for name, left in source_fields.items():
            right = compact_fields[name]
            if left.shape != right.shape or left.dtype != right.dtype:
                raise ValueError(f"Grid or dtype changed: {name}")
            if not _same_attributes(left.attrs, right.attrs):
                raise ValueError(f"Field metadata changed: {name}")
            digest = hashlib.sha256()
            for selection in _selections(left):
                before, after = left[selection].tobytes(), right[selection].tobytes()
                if before != after:
                    raise ValueError(f"Pixel bits changed: {name}")
                digest.update(before)
            result[name] = {
                "shape": list(left.shape), "dtype": str(left.dtype),
                "rawBytes": left.nbytes,
                "sourceStoredBytes": left.id.get_storage_size(),
                "compactStoredBytes": right.id.get_storage_size(),
                "dataSha256": digest.hexdigest(),
                "bitwiseEqual": True, "attributesEqual": True,
            }
    return result


def compact_black_marble(source: Path, destination: Path) -> dict:
    """Create and fully verify a new subset without overwriting any existing file."""
    source, destination = Path(source).resolve(strict=True), Path(destination).resolve()
    if source == destination or destination.exists():
        raise FileExistsError("Choose a new output path; the source and existing files are preserved.")
    before = source.stat()
    source_hash = file_sha256(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".part", delete=False) as stream:
            temporary = Path(stream.name)
        with h5py.File(source, "r") as original, h5py.File(temporary, "w") as subset:
            fields = _validate_fields(original)
            _copy_attributes(original.attrs, subset.attrs)
            subset.attrs["jmgj_format"] = FORMAT
            subset.attrs["jmgj_source_file"] = source.name
            subset.attrs["jmgj_source_sha256"] = source_hash
            subset.attrs["jmgj_created_utc"] = datetime.now(timezone.utc).isoformat()
            subset.attrs["jmgj_processing"] = "Field subset; gzip+shuffle; no resampling or quantization"
            ancestors = FIELD.rstrip("/").split("/")
            for count in range(1, len(ancestors) + 1):
                path = "/".join(ancestors[:count])
                _copy_attributes(original[path].attrs, subset.require_group(path).attrs)
            group = subset[FIELD]
            for name, dataset in fields.items():
                chunks = tuple(min(256, size) for size in dataset.shape)
                output = group.create_dataset(
                    name, shape=dataset.shape, dtype=dataset.dtype, chunks=chunks,
                    compression="gzip", compression_opts=9, shuffle=True, fletcher32=True,
                    fillvalue=dataset.fillvalue,
                )
                _copy_attributes(dataset.attrs, output.attrs)
                for selection in _selections(dataset):
                    output[selection] = dataset[selection]
        fields_report = verify_compact(source, temporary)
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("The source changed during conversion; output was not published.")
        report = {
            "format": FORMAT, "sourceFile": source.name, "sourceSha256": source_hash,
            "sourceBytes": before.st_size, "compactBytes": temporary.stat().st_size,
            "compactSha256": file_sha256(temporary),
            "compression": "gzip", "compressionLevel": 9, "shuffle": True,
            "resolutionPreserved": True, "allRetainedValuesBitwiseEqual": True,
            "sourceAttributesPreserved": True, "fields": fields_report,
        }
        # Rename is atomic and refuses an existing destination on Windows. No
        # source file is ever opened for writing or automatically deleted.
        if destination.exists():
            raise FileExistsError("Output appeared during conversion; it was not overwritten.")
        temporary.rename(destination)
        return report
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
