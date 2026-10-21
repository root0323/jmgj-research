from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

repo = Path(SPECPATH).parent
a = Analysis([str(repo / 'desktop/run_backend.py')], pathex=[str(repo / 'backend/src')],
             binaries=[], datas=collect_data_files('rasterio'),
             hiddenimports=collect_submodules('rasterio') + ['uvicorn.logging', 'uvicorn.loops.auto',
                            'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan.on'],
             hookspath=[], runtime_hooks=[], excludes=['tkinter', 'unittest', 'pytest', 'IPython'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='jmgj-backend', console=True, upx=False,
          append_pkg=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='jmgj-backend')
