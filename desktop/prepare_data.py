"""Stage a verified cloud release, or only its pinned catalogue for the app."""
import argparse
import json
import os
from pathlib import Path
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "src"))
from app.services.annual_black_marble import NAME, PRODUCT, YEAR, world_root
from app.services.black_marble_storage import file_sha256
from app.services.geospatial_assets import validate_light
from app.services.cloud_black_marble import read_catalogue


def stage_catalogue(source: Path, destination: Path):
    catalogue = read_catalogue(source / "index.json")
    clean = {"product": PRODUCT, "version": 2, "year": YEAR, "tiles": {
        tile: {key: item[key] for key in ("file", "compactBytes", "compactSha256")}
        for tile, item in sorted(catalogue["tiles"].items())}}
    destination.mkdir(parents=True, exist_ok=True)
    if any(path.is_file() and path.name != "index.json" for path in destination.rglob("*")):
        raise ValueError("App catalogue staging must contain no H5 or unrelated files.")
    (destination / "index.json").write_text(json.dumps(clean, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"tiles": len(clean["tiles"]), "catalogueBytes": (destination / "index.json").stat().st_size}


def stage(source: Path, destination: Path, expected_count=540):
    index = json.loads((source / "index.json").read_text(encoding="utf-8"))
    if index.get("product") != PRODUCT or index.get("year") != YEAR or len(index.get("tiles", {})) != expected_count:
        raise ValueError("A complete, verified 2025 Black Marble app dataset is required.")
    clean = {"product": PRODUCT, "version": 2, "year": YEAR, "tiles": {}}
    destination.mkdir(parents=True, exist_ok=True)
    for tile, item in sorted(index["tiles"].items()):
        match = NAME.fullmatch(item["file"])
        if not match or match[1] != tile:
            raise ValueError("Invalid Black Marble tile filename.")
        path = source / "compact" / item["file"]
        if path.stat().st_size != item["compactBytes"] or file_sha256(path) != item["compactSha256"]:
            raise ValueError("Black Marble subset integrity check failed: " + tile)
        validate_light(path)
        target = destination / "compact" / item["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        # Idempotent staging; a build interruption never publishes a partial tile.
        if not target.exists() or file_sha256(target) != item["compactSha256"]:
            temporary = target.with_suffix(".part")
            shutil.copyfile(path, temporary)
            if file_sha256(temporary) != item["compactSha256"]:
                raise ValueError("Black Marble copy integrity check failed.")
            temporary.replace(target)
        clean["tiles"][tile] = {key: item[key] for key in ("file", "compactBytes", "compactSha256")}
    # Reject unrelated leftovers rather than accidentally shipping research raws.
    allowed = {"index.json"} | {"compact/" + item["file"] for item in clean["tiles"].values()}
    if any(path.relative_to(destination).as_posix() not in allowed for path in destination.rglob("*") if path.is_file()):
        raise ValueError("Unexpected file in the bundled dataset. Inspect the staging folder.")
    temporary = destination / "index.json.tmp"
    temporary.write_text(json.dumps(clean, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(destination / "index.json")
    return {"tiles": len(clean["tiles"]), "bytes": sum(item["compactBytes"] for item in clean["tiles"].values())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--publish-directory", type=Path, help="Stage full verified tiles for Cloudflare publishing only")
    args = parser.parse_args()
    destination = Path(__file__).resolve().parent / "build/data-catalogue/black-marble/VJ146A4-2025"
    source = Path(os.environ["JMGJ_BLACK_MARBLE_SOURCE"]) if os.environ.get("JMGJ_BLACK_MARBLE_SOURCE") else world_root()
    print(json.dumps(stage(source, args.publish_directory) if args.publish_directory else stage_catalogue(source, destination)))
