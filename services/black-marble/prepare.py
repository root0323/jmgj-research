"""Publish only verified, losslessly compacted app data, without NASA credentials."""
import json
from pathlib import Path
import shutil
import sys

repo = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo))
from desktop.prepare_data import stage, world_root

if __name__ == "__main__":
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else world_root()
    root = Path(__file__).resolve().parent / "assets"
    result = stage(source, root / "VJ146A4-2025")
    shutil.copyfile(repo / "desktop/licenses/DATA-NOTICES.txt", root / "DATA-NOTICES.txt")
    shutil.copyfile(Path(__file__).with_name("_headers"), root / "_headers")
    (root / "index.html").write_text('<!doctype html><meta charset="utf-8"><title>AstroSky Black Marble</title>'
        '<h1>AstroSky Black Marble 2025</h1><p>Native-resolution, losslessly compressed app subsets of '
        'NASA VJ146A4 V2. These are derived files, not complete NASA products.</p>'
        '<p><a href="DATA-NOTICES.txt">Data sources and notices</a> · '
        '<a href="https://github.com/root0323/jmgj-research">Source and processing code</a></p>', encoding="utf-8")
    print(json.dumps(result))
