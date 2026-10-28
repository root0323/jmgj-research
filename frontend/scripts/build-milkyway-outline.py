# HEALPix sampling adapted from Stellarium Web Engine.
# Copyright (c) 2022 Stellarium Labs SRL
# SPDX-License-Identifier: AGPL-3.0-only
"""Derive a display outline from the bundled Stellarium Milky Way tiles.

Development only: requires numpy and Pillow. Run from any working directory.
The intensity contour is a visual guide, not a physical edge of the Galaxy.
HEALPix tile coordinates follow Stellarium Web Engine's healpix.c / hips.c;
the ICRS-to-galactic rotation follows ERFA/SOFA (see the asset README).
"""

from collections import deque
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

FRONTEND = Path(__file__).resolve().parents[1]
TILES = FRONTEND / "public/stellarium/skydata/surveys/milkyway/Norder0/Dir0"
ROTATION = np.array([
    [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
    [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
    [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669],
])
STEP = 0.25  # Degrees, equally spaced in galactic longitude and latitude.
LATITUDE_LIMIT = 60
THRESHOLD = 12  # Mean RGB intensity after one-degree Gaussian smoothing.


def galactic_to_icrs(longitude, latitude):
    lon, lat = np.deg2rad(longitude), np.deg2rad(latitude)
    galactic = np.stack([
        np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)
    ], axis=-1)
    return galactic @ ROTATION


def sample_tiles(vectors):
    """Sample HEALPix nested faces, including the HiPS UV-axis swap."""
    n = 512
    z = vectors[..., 2]
    tt = np.arctan2(vectors[..., 1], vectors[..., 0]) % (2 * np.pi) * 2 / np.pi
    jp = np.floor(n * (0.5 + tt - 0.75 * z)).astype(int)
    jm = np.floor(n * (0.5 + tt + 0.75 * z)).astype(int)
    ifp, ifm = jp // n, jm // n
    face = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
    ix, iy = jm % n, n - jp % n - 1
    polar = np.abs(z) > 2 / 3
    quadrant = np.minimum(tt.astype(int), 3)
    size = n * np.sqrt(3 * (1 - np.abs(z)))
    pjp = np.minimum(np.floor((tt - quadrant) * size).astype(int), n - 1)
    pjm = np.minimum(np.floor((1 - tt + quadrant) * size).astype(int), n - 1)
    face = np.where(polar, np.where(z >= 0, quadrant, quadrant + 8), face)
    ix = np.where(polar, np.where(z >= 0, n - pjm - 1, pjp), ix)
    iy = np.where(polar, np.where(z >= 0, n - pjp - 1, pjm), iy)
    image = np.zeros((*z.shape, 3), dtype=np.uint8)
    for index in range(12):
        tile = np.asarray(Image.open(TILES / f"Npix{index}.webp").convert("RGB"))
        assert tile.shape == (n, n, 3)
        mask = face == index
        image[mask] = tile[ix[mask], iy[mask]]
    return image


def largest_component(mask):
    """Keep the main band, excluding isolated stars and the Magellanic Clouds."""
    height, width = mask.shape
    unseen = mask.copy()
    largest = []
    for row, col in zip(*np.nonzero(mask)):
        if not unseen[row, col]:
            continue
        unseen[row, col] = False
        queue = deque([(row, col)])
        component = []
        while queue:
            y, x = queue.popleft()
            component.append((y, x))
            for ny, nx in [(y - 1, x), (y + 1, x), (y, (x - 1) % width), (y, (x + 1) % width)]:
                if 0 <= ny < height and unseen[ny, nx]:
                    unseen[ny, nx] = False
                    queue.append((ny, nx))
        if len(component) > len(largest):
            largest = component
    connected = np.zeros_like(mask)
    rows, cols = np.array(largest).T
    connected[rows, cols] = True
    return connected


def smooth_periodic(values):
    offsets = np.arange(-12, 13)
    weights = np.exp(-0.5 * (offsets * STEP / 1.0) ** 2)
    return sum(np.roll(values, int(offset)) * weight for offset, weight in zip(offsets, weights)) / weights.sum()


def main():
    longitude, latitude = np.meshgrid(
        np.arange(0, 360, STEP), np.arange(LATITUDE_LIMIT, -LATITUDE_LIMIT - STEP / 2, -STEP)
    )
    rgb = sample_tiles(galactic_to_icrs(longitude, latitude))
    gray = np.rint(rgb.mean(axis=-1)).astype(np.uint8)
    padding = 32
    periodic = np.pad(gray, ((0, 0), (padding, padding)), mode="wrap")
    blurred = np.asarray(Image.fromarray(periodic).filter(ImageFilter.GaussianBlur(1 / STEP)))[:, padding:-padding]
    band = largest_component(blurred >= THRESHOLD)
    assert band.any(axis=0).all(), "Main band must cover all galactic longitudes"
    assert not band[[0, -1]].any(), "Latitude sampling must contain the full band"
    upper = LATITUDE_LIMIT - np.argmax(band, axis=0) * STEP
    lower = -LATITUDE_LIMIT + np.argmax(band[::-1], axis=0) * STEP
    boundaries = []
    for edge in [upper, lower]:
        # One-degree vertices with a periodic smoothed seam; the native engine
        # joins them on the celestial sphere, including the RA=0 crossing.
        edge = smooth_periodic(edge)[::4]
        vector = galactic_to_icrs(np.arange(360), edge)
        ra = np.rad2deg(np.arctan2(vector[:, 1], vector[:, 0])) % 360
        dec = np.rad2deg(np.arcsin(vector[:, 2]))
        points = np.round(np.column_stack([ra, dec]), 5).tolist()
        points.append(points[0].copy())
        boundaries.append(points)
    assert np.isfinite(boundaries).all()
    assert np.all(upper > lower)
    data = {
        "description": "Visual envelope derived from the bundled Stellarium texture; not a physical galactic boundary.",
        "frame": "ICRS",
        "threshold": THRESHOLD,
        "boundaries": boundaries,
    }
    output = FRONTEND / "data/milkyway-outline.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"Wrote {output.name}: {sum(map(len, boundaries))} vertices, {output.stat().st_size} bytes")


if __name__ == "__main__":
    main()
