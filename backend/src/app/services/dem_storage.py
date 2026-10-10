"""Lossless native-resolution DEM storage, without display overviews."""
import hashlib
from pathlib import Path

import numpy as np
import rasterio

from app.services.geospatial_assets import AssetError

PACKED = "zstd-f32-v1"
ORIGINAL = "original-v1"
PROVENANCE = "JMGJ_DEM"


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def array_hash(data, mask):
    digest = hashlib.sha256(data.tobytes(order="C"))
    digest.update(mask.tobytes(order="C"))
    return digest.hexdigest()


def pack_tile(source_path, destination, record, source_sha):
    """Write/verify a candidate. Caller registers it before removing its source.

    Destination is an unindexed staging file. The native float32 bit pattern,
    validity mask, grid, and model-relevant metadata must all be identical.
    """
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with rasterio.open(source_path) as source:
            data, mask = source.read(), source.read_masks()
            digest = array_hash(data, mask)
            profile = dict(driver="GTiff", height=source.height, width=source.width,
                           count=source.count, dtype="float32", crs=source.crs,
                           transform=source.transform, nodata=source.nodata,
                           tiled=True, blockxsize=512, blockysize=512,
                           compress="ZSTD", zstd_level=18, predictor=3)
            with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
                with rasterio.open(destination, "w", **profile) as output:
                    output.write(data)
                    output.update_tags(**source.tags())
                    output.update_tags(1, **source.tags(1))
                    output.scales, output.offsets = source.scales, source.offsets
                    output.descriptions, output.units = source.descriptions, source.units
                    if not np.all(mask == 255):
                        output.write_mask(mask[0])
                    output.update_tags(ns=PROVENANCE, format=PACKED,
                                       source_sha256=source_sha, source_etag=record["etag"],
                                       source_bytes=str(record["bytes"]), array_sha256=digest)
            with rasterio.open(destination) as result:
                identical = (
                    np.array_equal(data.view("uint32"), result.read().view("uint32"))
                    and np.array_equal(mask, result.read_masks())
                    and source.crs == result.crs and source.transform == result.transform
                    and source.width == result.width and source.height == result.height
                    and source.nodata == result.nodata and source.dtypes == result.dtypes
                    and source.scales == result.scales and source.offsets == result.offsets
                    and source.descriptions == result.descriptions and source.units == result.units
                    and all(result.tags().get(k) == v for k, v in source.tags().items())
                    and all(result.tags(1).get(k) == v for k, v in source.tags(1).items())
                    and not result.overviews(1))
                if not identical:
                    raise AssetError("DEM 압축 전후의 고도 값·마스크·좌표·속성이 다릅니다. 원본을 유지합니다.")
        if destination.stat().st_size >= Path(source_path).stat().st_size:
            destination.unlink()
            return ORIGINAL, record["bytes"], source_sha, digest
        return PACKED, destination.stat().st_size, file_hash(destination), digest
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def verify_storage(path, record, stored, verify_original):
    """Authenticate a compact file against the recorded source/array hashes."""
    format_name, size, sha, source_sha, digest = stored
    if Path(path).stat().st_size != size or file_hash(path) != sha:
        raise AssetError("저장된 DEM 파일의 해시·크기가 달라 중단했습니다.")
    if format_name == ORIGINAL:
        if verify_original(path, record) != source_sha or sha != source_sha:
            raise AssetError("저장된 DEM 원본 검증 정보가 다릅니다.")
    elif format_name == PACKED:
        with rasterio.open(path) as source:
            tags = source.tags(ns=PROVENANCE)
            expected = dict(format=PACKED, source_sha256=source_sha,
                            source_etag=record["etag"], source_bytes=str(record["bytes"]),
                            array_sha256=digest)
            if (tags != expected or source.dtypes != ("float32",)
                    or array_hash(source.read(), source.read_masks()) != digest):
                raise AssetError("DEM 압축본의 고도 값·원본 검증 정보가 다릅니다.")
    else:
        raise AssetError("지원하지 않는 DEM 저장 형식입니다.")
