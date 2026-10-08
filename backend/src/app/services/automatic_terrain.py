"""One desktop terrain job at a time; location changes never download NASA data."""
from pathlib import Path
import threading

from app.services.geospatial_assets import (
    AssetError, cached_region, prepare_region, region_bounds,
)
from app.services.annual_black_marble import cached_annual_tiles


class TerrainPreparation:
    def __init__(self):
        self.lock = threading.RLock()
        self.active = None
        self.jobs = {}

    def request(self, latitude: float, longitude: float, *, start: bool):
        bounds = region_bounds(latitude, longitude)
        key = (round(latitude, 6), round(longitude, 6))
        with self.lock:
            job = self.jobs.get(key)
            if job and job["state"] == "running":
                return self._public(job)
            region = cached_region(latitude, longitude)
            if region:
                return {"enabled": True, "state": "ready", "dem": True, "blackMarble": True,
                        "message": "지형·야간광 자료 준비됨"}
            if job and job["state"] == "ready" and Path(job["path"]).is_file():
                return self._public(job)
            if not start:
                return self._public(job) if job else {"enabled": True, "state": "idle", "message": "지형 자료 확인 중…"}
            if self.active is not None:
                return {"enabled": True, "state": "waiting", "message": "이전 장소의 지형 저장 후 준비합니다…"}
            # The client polls only while this place remains selected. There is
            # no unbounded queue when the user moves around the map.
            if len(self.jobs) >= 32:
                self.jobs.clear()
            job = {"state": "running", "message": "저장된 지형 자료 확인 중…", "dem": False,
                   "blackMarble": bool(cached_annual_tiles(bounds))}
            self.jobs[key] = job
            self.active = key
            threading.Thread(target=self._run, args=(key, latitude, longitude), daemon=True).start()
            return self._public(job)

    @staticmethod
    def _public(job):
        return {"enabled": True, **{k: v for k, v in job.items() if k != "path"}}

    def _run(self, key, latitude, longitude):
        def progress(message):
            with self.lock:
                self.jobs[key]["message"] = message
        try:
            # Reuses the installed worldwide Black Marble bundle. Never asks
            # an end user for NASA credentials or calls NASA from this job.
            region = prepare_region(latitude, longitude, terrain_only=True, progress=progress)
            black = bool(cached_annual_tiles(region["bounds"]))
            with self.lock:
                self.jobs[key].update(state="ready", dem=True, blackMarble=black, path=region["dem"],
                    message="지형·야간광 자료 준비됨" if black else "지형 준비됨 · 이 지역의 야간광 자료 없음")
        except Exception as error:
            # Raw exceptions can contain paths or upstream URLs. Show only
            # authored asset messages, never provider exception strings.
            message = str(error) if isinstance(error, AssetError) else "지형 자료를 저장하지 못했습니다. 연결과 저장 공간을 확인해 주세요."
            with self.lock:
                self.jobs[key].update(state="error", message=message)
        finally:
            with self.lock:
                self.active = None


TERRAIN = TerrainPreparation()
