import os
import subprocess
import sys
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api.endpoints.health import router
from app.desktop_security import DesktopAccessMiddleware


class StartupReadinessTests(unittest.TestCase):
    def test_ready_checks_private_worker_without_reading_data_or_network(self):
        token = "a" * 64
        with patch.dict(os.environ, {"JMGJ_DESKTOP_TOKEN": token}), \
             patch("app.api.endpoints.health.cached_status", side_effect=AssertionError("data scan")), \
             patch("requests.get", side_effect=AssertionError("network")):
            app = FastAPI()
            app.add_middleware(DesktopAccessMiddleware)
            app.include_router(router, prefix="/api/health")
            client = TestClient(app)
            self.assertEqual(client.get("/api/health/ready").status_code, 403)
            self.assertEqual(client.get("/api/health/ready", headers={"x-jmgj-desktop-token": "b" * 64}).status_code, 403)
            response = client.get("/api/health/ready", headers={"x-jmgj-desktop-token": token})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"ok": True})

    def test_opening_app_does_not_load_model_compiler_or_raster_engine(self):
        subprocess.run([sys.executable, "-c", "import app.main, sys; "
                        "assert 'numba' not in sys.modules; assert 'rasterio' not in sys.modules"], check=True)
